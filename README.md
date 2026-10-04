# D-XPhone v2.0

**Ứng dụng gọi thoại & video 1-1 thời gian thực** – Production-ready.

Thiết kế module độc lập, có thể chạy riêng hoặc nhúng vào D-Social / ứng dụng khác.

## Tính năng v2.0 (ổn định + chịu tải)

- WebRTC P2P Audio + Video 1-1
- Signaling Server (Socket.io) với **Redis adapter** → scale ngang
- **Redis-backed room management** (TTL, không mất dữ liệu khi restart)
- **JWT authentication** cho join room
- **Rate limiting** chống spam
- **Structured logging** (Winston)
- Reconnection + ICE restart phía client
- Cấu hình sẵn **TURN** (coturn)
- **Docker Compose** full stack (Redis + Signaling + Frontend)
- Health check + metrics cơ bản

## Cấu trúc

```
D-XPhone/
├── backend/
│   ├── src/
│   │   ├── auth.js          # JWT
│   │   ├── rooms.js         # Redis / memory room manager
│   │   └── logger.js        # Winston
│   ├── server.js
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
├── frontend/public/
│   ├── index.html
│   ├── styles.css
│   └── app.js               # Client WebRTC + reconnection
├── turn/
│   └── turnserver.conf.example
├── docker-compose.yml
└── README.md
```

## Chạy nhanh với Docker (khuyến nghị)

```bash
git clone https://github.com/nguyenxuandat20091985-rgb/D-XPhone.git
cd D-XPhone
docker compose up -d --build
# Frontend:  http://localhost:3000
# Signaling: http://localhost:3001/health
```

## Chạy development

```bash
# Redis
docker run -d -p 6379:6379 redis:7-alpine

# Backend
cd backend && cp .env.example .env && npm install && npm start

# Frontend
npx serve frontend/public -p 3000
```

## API chính

| Method | Path       | Mô tả                          |
|--------|------------|--------------------------------|
| GET    | `/health`  | Health check + Redis status    |
| POST   | `/token`   | Lấy JWT (body: `{userId, roomId?}`) |

## Cấu hình TURN (bắt buộc cho production)

1. Deploy coturn (xem `turn/turnserver.conf.example`)
2. Mở firewall: 3478/tcp+udp, 5349/tcp, 49152-65535/udp
3. Uncomment phần TURN trong `frontend/public/app.js`

## Scale ngang

Chạy nhiều instance signaling (cùng REDIS_URL) + Load Balancer. Redis adapter đã bật sẵn.

## License

MIT
