const cors = require('cors');
const express = require('express');
const dotenv = require('dotenv');
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
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
app.use('/upload', uploadRoutes);

// 서버 실행
app.listen(PORT, () => {
  console.log(`서버 실행 중 ${PORT}`);
});

//git test