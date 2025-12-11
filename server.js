const cors = require('cors');
const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const fileUploadRoutes = require('./routes/fileUpload');
const axios = require('axios')
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

// 업로드된 파일 다운로드를 위한 정적 파일 제공
// 로컬 개발: proxy/uploads, Docker: /app/files
const uploadsPath = process.env.NODE_ENV === 'production' 
  ? '/app/files' 
  : path.join(__dirname, 'uploads');
console.log('파일 제공 경로:', uploadsPath);
app.use('/files', express.static(uploadsPath));

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