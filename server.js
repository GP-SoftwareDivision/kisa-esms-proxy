const cors = require('cors');
const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const { router: fileUploadRoutes, getFromSftp, getUploadDir } = require('./routes/fileUpload');
const axios = require('axios')
const fs = require('fs'); // Added fs module
dotenv.config();

const app = express();
const PORT = 8080;

// CORS 설정
const corsOptions = {
  origin: ['http://localhost:5173',process.env.BACKEND_URL],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 업로드된 파일 다운로드 설정
// 로컬 개발: proxy/uploads, Docker: /app/files
const uploadsPath = process.env.NODE_ENV === 'production' 
  ? '/app/files' 
  : path.join(__dirname, 'uploads');

// 1. 먼저 로컬에서 정적 파일 찾기
app.use('/files', express.static(uploadsPath));

// 2. 로컬에 없는 경우 SFTP 서버에서 직접 가져오기 (Smart Fallback)
app.get('/files/:fileName', async (req, res) => {
    try {
        const { fileName } = req.params;
        const fileBuffer = await getFromSftp(fileName);
        
        if (fileBuffer) {
            // 로컬 캐싱 (다음 요청 최적화 및 컨테이너 복구)
            const localPath = path.join(getUploadDir(), fileName);
            const uploadDir = getUploadDir();
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            fs.writeFileSync(localPath, fileBuffer);

            // 파일 전송
            res.setHeader('Content-Type', 'application/octet-stream');
            // 한글 파일명 다운로드 깨짐 방지 처리
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
            return res.send(fileBuffer);
        }
        
        res.status(404).send('File not found');
    } catch (error) {
        console.error('SFTP 폴백 처리 중 오류:', error);
        res.status(500).send('Server error');
    }
});

app.use('/api', async (req, res) => {
  try {
    const {method, body, url} = req;
    const response = await axios({
      method: method,
      url: `${process.env.BACKEND_URL}/api${url}`,
      data: body,
      headers: {
        'Content-Type': req.headers['content-type'],
        'Cookie': req.headers['cookie']
      },
      withCredentials: true,
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    return res.status(error.response?.status || 500).json({
      message: error.response?.data || 'Internal Server Error',
      error: error.message,
    });
  }
});

// 라우터 설정
app.use('/auth', authRoutes);
app.use('/upload', uploadRoutes); // 기존 업로드 (유지)
app.use('/file-upload', fileUploadRoutes); // 새로운 파일 업로드 (CSV/XLSX)

// 서버 실행
app.listen(PORT, () => {
  console.log(`서버 실행 중 ${PORT}`);
});

//git test