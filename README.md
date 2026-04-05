# Railway / Render Backend

Bu servis `playlist` ve `upload` islerini Cloudflare R2 uzerinden yonetir.

## Uclar

- `GET /health`
- `GET /playlist`
- `POST /upload`

## Kurulum

1. `backend/.env.example` dosyasini `.env` olarak kopyala.
2. R2 bilgilerini doldur.
3. `npm install`
4. `npm run dev`

## Gerekli env

- `UPLOAD_TOKEN`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_BASE_URL`

## Deploy

Bu klasor dogrudan `Railway` veya `Render Web Service` olarak deploy edilebilir.

Baslangic komutu:

`npm start`
