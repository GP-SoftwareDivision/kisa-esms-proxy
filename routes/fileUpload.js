const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const SftpClient = require('ssh2-sftp-client');

/**
 * 업로드 디렉토리 경로 가져오기 (로컬 프록시 서버용)
 * 우선순위:
 * 1. 운영 환경 docker 컨테이너 내 (/app/files)
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
    if (!process.env.SFTP_HOST && !process.env.SSH_HOST) {
        console.log('SFTP 환경변수가 설정되지 않아 SFTP 업로드를 건너뜁니다.');
        return;
    }

    const sftp = new SftpClient();
    const config = {
        host: process.env.SFTP_HOST || process.env.SSH_HOST,
        port: parseInt(process.env.SFTP_PORT || process.env.SSH_PORT || '22'),
        username: process.env.SFTP_USER || process.env.SSH_USERNAME,
        password: process.env.SFTP_PASSWORD || process.env.SSH_PASSWORD,
    };

    try {
        await sftp.connect(config);
        const remoteDir = process.env.SFTP_UPLOAD_DIR || '/uploads/leaked';
        const remotePath = path.posix.join(remoteDir, fileName);

        if (!await sftp.exists(remoteDir)) {
            await sftp.mkdir(remoteDir, true);
        }

        await sftp.put(localFilePath, remotePath);
    } catch (err) {
        console.error('SFTP 전송 중 오류 발생:', err.message);
        throw new Error(`SFTP 전송 실패: ${err.message}`);
    } finally {
        await sftp.end();
    }
}

/**
 * SFTP 서버에서 파일 직접 가져오기 (폴백용)
 */
async function getFromSftp(fileName) {
    if (!process.env.SFTP_HOST && !process.env.SSH_HOST) return null;

    const sftp = new SftpClient();
    const config = {
        host: process.env.SFTP_HOST || process.env.SSH_HOST,
        port: parseInt(process.env.SFTP_PORT || process.env.SSH_PORT || '22'),
        username: process.env.SFTP_USER || process.env.SSH_USERNAME,
        password: process.env.SFTP_PASSWORD || process.env.SSH_PASSWORD,
    };

    try {
        await sftp.connect(config);
        const remoteDir = process.env.SFTP_UPLOAD_DIR || '/uploads/leaked';
        const remotePath = path.posix.join(remoteDir, fileName);

        if (await sftp.exists(remotePath)) {
            return await sftp.get(remotePath);
        }
        return null;
    } catch (err) {
        console.error('SFTP 폴백 시도 실패:', err.message);
        return null;
    } finally {
        await sftp.end();
    }
}

// XLSX 파일 업로드 설정
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
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
            try {
                if (!/[^\u0000-\u00ff]/.test(file.originalname)) {
                    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
                }
            } catch (e) {
                console.error('파일명 인코딩 변환 오류:', e);
            }
            
            const timestamp = Date.now();
            const ext = path.extname(file.originalname);
            const nameWithoutExt = path.basename(file.originalname, ext);
            const safeName = nameWithoutExt.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_');
            cb(null, `${safeName}_${timestamp}${ext}`);
        },
    }),
});

async function saveUploadedFile(localFilePath, fileName) {
    try {
        const uploadDir = getUploadDir();
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        const destinationPath = path.join(uploadDir, fileName);
        fs.copyFileSync(localFilePath, destinationPath);
        fs.unlinkSync(localFilePath);
        await uploadToSftp(destinationPath, fileName);
        return destinationPath;
    } catch (err) {
        console.error('파일 처리 중 오류 발생:', err);
        throw err;
    }
}

router.post('/', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).send({ success: false, msg: '업로드된 파일이 없습니다.' });
    }

    try {
        await saveUploadedFile(file.path, file.filename);
        res.send({ 
            success: true,
            msg: '파일 업로드 성공',
            data: {
                fileName: file.originalname,
                savedFileName: file.filename,
                fileSize: file.size
            }
        });
    } catch (error) {
        console.error('파일 업로드 처리 중 오류 발생:', error);
        res.status(500).send({ success: false, msg: '파일 업로드 실패', error: error.message });
    }
});

router.delete('/:fileName', async (req, res) => {
    const { fileName } = req.params;
    try {
        const uploadDir = getUploadDir();
        const filePath = path.join(uploadDir, fileName);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.send({ success: true, msg: '파일 삭제 성공' });
    } catch (error) {
        console.error('파일 삭제 중 오류 발생:', error);
        res.status(500).send({ success: false, msg: '파일 삭제 실패', error: error.message });
    }
});

module.exports = {
    router,
    getFromSftp,
    getUploadDir
};
