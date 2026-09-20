# Jev tic-tac-toe — Cloudflare Pages

Bản demo web cho thấy Jev nhận **state** của bàn cờ và trả một `choice` là ô đi tiếp theo.

- `web/index.html` — game cờ 3×3.
- `web/gomoku.html` — game caro 16×16.
- `functions/api/systemone.js` — Cloudflare Pages Function tại route `POST /api/systemone`.
- `TYPESAFE_API_KEY` chỉ tồn tại trong Cloudflare secret; không đi vào browser JavaScript.

## Caro 16×16

Trang `/gomoku` (hoặc `/gomoku.html`) dùng luật: **5 quân liên tiếp trở lên** theo ngang/dọc/chéo thắng, trừ khi hai đầu của chuỗi quân tối đa đều bị quân đối thủ chặn. Mép bàn cờ không được tính là một quân chặn.

Mỗi lượt thông thường, UI gửi **toàn bộ ô trống hợp lệ** cho Jev trong một `next_move` choice. State chỉ gửi danh sách quân đang có (`board.stones`); mỗi criteria chỉ là nhãn tọa độ như `"H8": "Legal empty cell H8."`. Browser không tính hay gửi điểm số chiến thuật theo từng ô. Prompt yêu cầu Jev tự đọc toàn bộ thế cờ, ưu tiên thắng ngay, chặn thắng ngay, các thế bốn/ba mở, rồi phát triển thế cờ.

Jev `choice` giới hạn 255 options. Khi người chơi đánh trước, lượt Jev đầu tiên có đúng 255 ô trống nên vẫn gửi đủ toàn bộ. Chỉ chế độ **Jev đi trước** bắt đầu với 256 ô trống; lượt khai cuộc đó UI gửi bốn ô trung tâm `H8`, `H9`, `I8`, `I9` vì không thể đưa 256 lựa chọn vào một choice duy nhất. Từ lượt kế tiếp trở đi, mọi ô trống hợp lệ đều được gửi.

## Chạy local bằng Cloudflare runtime

Cần Node.js 18+.

```bash
cd /home/hieptran/Desktop/jev-idea
npm install
cp .dev.vars.example .dev.vars
```

Mở `.dev.vars`, điền API key:

```dotenv
TYPESAFE_API_KEY=your_typesafe_api_key
```

Chạy:

```bash
npm run dev
```

Wrangler sẽ in ra URL local. Mở URL đó, **không dùng VS Code Live Server**. Pages Function mới có route `/api/systemone`.

## Deploy qua Cloudflare Pages + GitHub

1. Tạo repository GitHub từ thư mục này và push code.
2. Trong Cloudflare Dashboard, vào **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
3. Chọn repository.
4. Điền cấu hình build:

| Field | Value |
| --- | --- |
| Framework preset | `None` |
| Build command | để trống |
| Build output directory | `web` |
| Root directory | để trống / repository root |

5. Deploy lần đầu.
6. Vào **Settings** → **Environment variables**. Thêm secret:

```text
TYPESAFE_API_KEY = your_typesafe_api_key
```

Thêm vào cả **Production** và **Preview** nếu muốn preview deployment cũng gọi được Jev.
7. Redeploy project.

Cloudflare tự nhận thư mục `functions/` ở repository root. File `functions/api/systemone.js` sẽ trở thành endpoint:

```text
POST https://<your-project>.pages.dev/api/systemone
```

UI đã gọi relative endpoint `/api/systemone`, nên không cần sửa domain sau khi deploy.

## Deploy bằng Wrangler CLI (tùy chọn)

Đăng nhập và tạo project Pages một lần:

```bash
npx wrangler login
npx wrangler pages project create jev-tic-tac-toe
```

Deploy:

```bash
npx wrangler pages deploy web --project-name jev-tic-tac-toe
```

Sau đó vẫn thêm `TYPESAFE_API_KEY` qua Cloudflare Dashboard, hoặc dùng:

```bash
npx wrangler pages secret put TYPESAFE_API_KEY --project-name jev-tic-tac-toe
```

## Bảo vệ API key và chi phí

Function không phải generic proxy: nó chỉ chấp nhận request có schema cờ caro 3×3 với model `jev-latest`, và chỉ cho `criteria` là ô trống hợp lệ. Tuy vậy, người biết URL vẫn có thể gọi endpoint game hợp lệ và làm phát sinh chi phí.

Trước khi đưa link cho công chúng, bật ít nhất một lớp bảo vệ:

- **Cloudflare Access**: chỉ email/tài khoản bạn cho phép được vào web.
- **Rate limiting rule**: giới hạn `POST /api/systemone` theo IP.
- Nếu public: thêm Cloudflare Turnstile và xác minh token trong Pages Function.

Không bao giờ đặt `TYPESAFE_API_KEY` trong `web/index.html`, Git, hoặc biến frontend kiểu `VITE_*`.
