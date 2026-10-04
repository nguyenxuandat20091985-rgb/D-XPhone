# D-XPhone

**Ứng dụng gọi thoại & video 1-1 thời gian thực độc lập** sử dụng WebRTC + Node.js + Socket.io.

Thiết kế dạng **module/service độc lập**, có thể chạy riêng hoặc dễ dàng nhúng / gọi API vào các ứng dụng khác (ví dụ: mạng xã hội D-Social).

## Tính năng

- Gọi Audio (thoại) và Video 1-1 real-time
- Signaling Server bằng Socket.io (Offer / Answer / ICE Candidate)
- Sử dụng STUN công cộng miễn phí (Google)
- Giao diện gọi điện hiện đại: video local + remote, tắt/bật mic, tắt/bật camera, cúp máy
- Hoàn toàn mã nguồn mở, miễn phí

## Cấu trúc thư mục

```
D-XPhone/
├── backend/                  # Signaling Server (Node.js + Socket.io)
│   ├── package.json
│   └── server.js
├── frontend/
│   └── public/               # Giao diện client (có thể serve static)
│       ├── index.html
│       ├── styles.css
│       └── app.js
├── .gitignore
└── README.md
```

## Yêu cầu hệ thống

- Node.js >= 18
- Trình duyệt hiện đại hỗ trợ WebRTC (Chrome, Firefox, Edge, Safari)
- HTTPS (hoặc localhost) để truy cập camera/microphone

## Cài đặt & Chạy nhanh

### 1. Backend (Signaling Server)

```bash
cd backend
npm install
npm start
```

Server chạy tại: `http://localhost:3001`

### 2. Frontend

Bạn có thể mở trực tiếp file `frontend/public/index.html` bằng Live Server (VS Code) hoặc serve bằng bất kỳ static server nào:

```bash
# Ví dụ dùng npx serve
npx serve frontend/public -p 3000
```

Hoặc dùng Python:

```bash
cd frontend/public
python -m http.server 3000
```

Sau đó mở trình duyệt: `http://localhost:3000`

### 3. Kiểm thử

1. Mở 2 tab trình duyệt (hoặc 2 thiết bị khác nhau trong cùng mạng).
2. Nhập **cùng một Room ID**.
3. Nhấn **Tham gia cuộc gọi**.
4. Cho phép quyền camera + microphone.
5. Cuộc gọi sẽ được thiết lập tự động.

## Cấu hình STUN / TURN

File `frontend/public/app.js` đã cấu hình sẵn STUN của Google:

```js
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};
```

**Lưu ý quan trọng về NAT:**

- STUN chỉ đủ khi cả 2 peer ở mạng công cộng hoặc NAT đơn giản.
- Với mạng phức tạp (symmetric NAT, firewall), bạn **cần TURN server**.

### Tự host TURN (khuyến nghị cho production)

Sử dụng [coturn](https://github.com/coturn/coturn) (mã nguồn mở miễn phí):

```bash
# Ví dụ cấu hình coturn cơ bản (cần domain + public IP)
# turnserver.conf
listening-port=3478
fingerprint
lt-cred-mech
user=dxphone:strongpassword
realm=yourdomain.com
```

Sau đó thêm vào `ICE_SERVERS`:

```js
{
  urls: 'turn:yourdomain.com:3478',
  username: 'dxphone',
  credential: 'strongpassword'
}
```

## Tích hợp vào ứng dụng khác (D-Social)

Vì D-XPhone được thiết kế module độc lập:

1. **Signaling Server** có thể chạy như một microservice riêng (port 3001).
2. Frontend có thể:
   - Embed iframe
   - Hoặc copy logic WebRTC (`app.js`) vào component của ứng dụng chính
   - Gọi API health check `/health` để kiểm tra trạng thái service

Ví dụ gọi từ ứng dụng khác:

```js
// Kết nối tới Signaling Server của D-XPhone
const socket = io('https://signaling.yourdomain.com');
```

## Biến môi trường (Backend)

| Biến       | Mặc định | Mô tả              |
|------------|----------|--------------------|
| `PORT`     | `3001`   | Port chạy server   |

## License

MIT — Sử dụng tự do cho mục đích cá nhân & thương mại.
