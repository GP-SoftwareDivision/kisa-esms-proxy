const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// CSV, XLSX 파일 업로드 설정
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB 제한
    fileFilter: (req, file, cb) => {
        // CSV, XLSX 파일만 허용
        const allowedExtensions = ['.csv', '.xlsx', '.xls'];
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedExtensions.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('CSV 또는 XLSX 파일만 업로드 가능합니다.'));
        }
    },
    storage: multer.diskStorage({
        filename: function (_req, file, cb) {
            // 한글 파일명 처리
            file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
            
            // 파일명 중복 방지 (타임스탬프 추가)
            const timestamp = Date.now();
            const ext = path.extname(file.originalname);
            const nameWithoutExt = path.basename(file.originalname, ext);
            const uniqueFileName = `${nameWithoutExt}_${timestamp}${ext}`;
            
            cb(null, uniqueFileName);
        },
    }),
});

/**
 * 파일을 최종 저장 디렉토리로 이동
 */
async function saveUploadedFile(localFilePath, fileName) {
    console.log('파일 저장 시작:', fileName);
    try {
        // 로컬 개발: proxy/uploads, Docker: /app/files
        const uploadDir = process.env.NODE_ENV === 'production' 
            ? '/app/files' 
            : path.join(__dirname, '../uploads');

        console.log('저장 경로:', uploadDir);
        
        // 디렉토리가 없으면 생성
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // 파일을 해당 디렉토리로 이동
        const destinationPath = path.join(uploadDir, fileName);
        fs.copyFileSync(localFilePath, destinationPath);
        fs.unlinkSync(localFilePath); // 임시 파일 삭제

        console.log('파일 저장 성공:', destinationPath);
        return destinationPath;
    } catch (err) {
        console.error('파일 저장 중 오류 발생:', err);
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
        // 파일 저장
        await saveUploadedFile(file.path, file.filename);

        // 다운로드 가능한 URL 생성
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
        const filePath = path.join('/app/files', fileName);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).send({ 
                success: false,
                msg: '파일을 찾을 수 없습니다.' 
            });
        }

        fs.unlinkSync(filePath);
        
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
