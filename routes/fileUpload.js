const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const SftpClient = require('ssh2-sftp-client');

/**
 * 업로드 디렉토리 경로 가져오기 (로컬 프록시 서버용)
 * 우선순위:
 * 1. 운영 환경 (/app/files)
 * 2. 개발 환경 (../uploads)
 */
const getUploadDir = () => {
    return process.env.NODE_ENV === 'production' 
        ? '/app/files' 
        : path.join(__dirname, '../uploads');
};

/**
 * SFTP 서버로 파일 전송
 */
async function uploadToSftp(localFilePath, fileName) {
    // SFTP 설정이 없으면 스킵 (개발 환경 등)
    if (!process.env.SFTP_HOST && !process.env.SSH_HOST) {
        console.log('SFTP 환경변수가 설정되지 않아 SFTP 업로드를 건너뜁니다.');
        return;
    }

    const sftp = new SftpClient();
    
    // 환경변수 매핑 (SFTP_ 접두어 우선, 없으면 SSH_ 접두어 사용)
    const config = {
        host: process.env.SFTP_HOST || process.env.SSH_HOST,
        port: parseInt(process.env.SFTP_PORT || process.env.SSH_PORT || '22'),
        username: process.env.SFTP_USER || process.env.SSH_USERNAME,
        password: process.env.SFTP_PASSWORD || process.env.SSH_PASSWORD,
    };

    try {
        console.log(`SFTP 연결 시도: ${config.host}:${config.port}`);
        await sftp.connect(config);

        // 원격 디렉토리 경로 (환경변수 또는 기본값)
        // posix.join을 사용하여 리눅스 경로 스타일 유지
        const remoteDir = process.env.SFTP_UPLOAD_DIR || '/upload';
        const remotePath = path.posix.join(remoteDir, fileName);

        // 원격 디렉토리가 존재하는지 확인하고 없으면 생성 (recursive)
        if (!await sftp.exists(remoteDir)) {
            console.log(`원격 디렉토리 생성: ${remoteDir}`);
            await sftp.mkdir(remoteDir, true);
        }

        console.log(`SFTP 파일 전송 시작: ${localFilePath} -> ${remotePath}`);
        await sftp.put(localFilePath, remotePath);
        console.log('SFTP 파일 전송 성공');

    } catch (err) {
        console.error('SFTP 전송 중 오류 발생:', err.message);
        // SFTP 전송 실패를 전체 실패로 간주하려면 throw err;
        // 여기서는 로컬 저장이 성공했으므로 에러 로그만 남기고 진행할 수도 있지만,
        // 요구사항에 "sftp파일서버에 전송"이 명시되었으므로 throw하여 클라이언트에 알림.
        throw new Error(`SFTP 전송 실패: ${err.message}`);
    } finally {
        await sftp.end();
    }
}

// CSV, XLSX 파일 업로드 설정
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB 제한
    fileFilter: (req, file, cb) => {
        // XLSX 파일만 허용
        const allowedExtensions = ['.xlsx'];
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedExtensions.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('xlsx 형식의 파일만 업로드 가능합니다.'));
        }
    },
    storage: multer.diskStorage({
        filename: function (_req, file, cb) {
            // 한글 파일명 깨짐 방지 (latin1 -> utf8 재인코딩)
            // 브라우저에서 보낸 파일명이 latin1으로 잘못 인식된 경우를 복구합니다.
            try {
                if (/[^\u0000-\u00ff]/.test(file.originalname)) {
                    // 이미 유니코드가 포함되어 있다면 그대로 진행
                } else {
                    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
                }
            } catch (e) {
                console.error('파일명 인코딩 변환 오류:', e);
            }
            
            // 파일명 중복 방지 (타임스탬프 추가)
            const timestamp = Date.now();
            const ext = path.extname(file.originalname);
            const nameWithoutExt = path.basename(file.originalname, ext);
            
            // 특수문자 제거 및 공백을 언더바로 변경 (파일명 안전성 확보)
            const safeName = nameWithoutExt.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_');
            const uniqueFileName = `${safeName}_${timestamp}${ext}`;
            
            cb(null, uniqueFileName);
        },
    }),
});

/**
 * 파일을 최종 저장 디렉토리로 이동 및 SFTP 전송
 */
async function saveUploadedFile(localFilePath, fileName) {
    console.log('파일 저장 시작:', fileName);
    try {
        const uploadDir = getUploadDir();

        console.log('로컬 저장 경로:', uploadDir);
        
        // 디렉토리가 없으면 생성
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // 파일을 해당 디렉토리로 이동 (로컬 저장)
        const destinationPath = path.join(uploadDir, fileName);
        fs.copyFileSync(localFilePath, destinationPath);
        fs.unlinkSync(localFilePath); // 임시 파일 삭제

        console.log('로컬 파일 저장 성공:', destinationPath);

        // 로컬 저장이 완료된 후 SFTP 전송 시도
        await uploadToSftp(destinationPath, fileName);

        return destinationPath;
    } catch (err) {
        console.error('파일 처리 중 오류 발생:', err);
        throw err;
    }
}

/**
 * POST /file-upload
 * CSV, XLSX 파일 업로드 및 다운로드 URL 반환
 */
router.post('/', upload.single('file'), async (req, res) => {
    const file = req.file;
    
    if (!file) {
        return res.status(400).send({ 
            success: false,
            msg: '업로드된 파일이 없습니다.' 
        });
    }

    try {
        // 파일 저장 (로컬 + SFTP)
        await saveUploadedFile(file.path, file.filename);

        // 다운로드 가능한 URL 생성 (프록시 서버 기준)
        const downloadUrl = `/files/${file.filename}`;

        res.send({ 
            success: true,
            msg: '파일 업로드 성공',
            data: {
                fileName: file.originalname,
                savedFileName: file.filename,
                filePath: downloadUrl,
                fileSize: file.size,
                mimeType: file.mimetype
            }
        });
    } catch (error) {
        console.error('파일 업로드 처리 중 오류 발생:', error);
        res.status(500).send({ 
            success: false,
            msg: '파일 업로드 실패',
            error: error.message 
        });
    }
});

/**
 * DELETE /file-upload/:fileName
 * 업로드된 파일 삭제
 */
router.delete('/:fileName', async (req, res) => {
    const { fileName } = req.params;
    
    try {
        const uploadDir = getUploadDir();
        const filePath = path.join(uploadDir, fileName);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).send({ 
                success: false,
                msg: '파일을 찾을 수 없습니다.' 
            });
        }

        // 로컬 파일 삭제
        fs.unlinkSync(filePath);
        
        // TODO: 필요시 SFTP 파일 삭제 로직 추가 가능
        
        res.send({ 
            success: true,
            msg: '파일 삭제 성공' 
        });
    } catch (error) {
        console.error('파일 삭제 중 오류 발생:', error);
        res.status(500).send({ 
            success: false,
            msg: '파일 삭제 실패',
            error: error.message 
        });
    }
});

module.exports = router;
