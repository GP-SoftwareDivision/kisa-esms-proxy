const express = require('express');
const router = express.Router();
const fs = require('fs');
const SftpClient = require('ssh2-sftp-client');

const multer = require('multer');

const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 100 * 1024 * 1024 },
    storage: multer.diskStorage({
        filename: function (_req, file, cb) {
            file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
            cb(null, file.originalname);
        },
    }),
});

async function uploadFileDevelop(localFilePath, sftpFileName) {
    console.log('로컬 파일 저장 시작');
    try {
        console.log('파일 저장 시작');

        const uploadDir = '/app/files'

        console.log('경로', uploadDir)
        // 디렉토리가 없으면 생성
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // 파일을 해당 디렉토리로 이동
        const destinationPath = path.join(uploadDir, sftpFileName);
        fs.copyFileSync(localFilePath, destinationPath);
        fs.unlinkSync(localFilePath); // 원본 파일 삭제

        console.log('파일 저장 성공:', destinationPath);
		
        return destinationPath;
    } catch (err) {
        console.error('파일 업로드 중 오류 발생: ', err);
        throw err;
    }
}


router.post('/', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).send({ msg: '업로드된 파일이 없습니다.' });
    }
    try {

        await uploadFileDevelop(file.path, file.originalname);

        res.send({ msg: '업로드 성공' });
    } catch (error) {
        console.error('업로드 처리 중 오류 발생:', error);
        res.status(500).send({ msg: '업로드 실패.' });
    }
});

module.exports = router;