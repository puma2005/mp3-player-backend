import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const required = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL',
];

const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Eksik env degiskenleri: ${missing.join(', ')}`);
}

const app = express();
const port = Number(process.env.PORT || 8080);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,
  },
});

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

const bucketName = process.env.R2_BUCKET_NAME || 'mp3-player-assets';
const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const uploadToken = process.env.UPLOAD_TOKEN || 'serkan2026yukle';
const defaultArtist = process.env.DEFAULT_ARTIST || 'Serkan Saver';
const defaultCoverUrl =
  process.env.DEFAULT_COVER_URL ||
  'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=600&q=80';
const playlistName = process.env.PLAYLIST_NAME || 'Serkan Saver 2026';
const playlistDescription = process.env.PLAYLIST_DESCRIPTION || 'Serkan Saver parcalarinin online listesi.';

app.use(cors());
app.use(express.json());

const streamToText = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const slugify = (value) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const titleFromFilename = (value) =>
  value
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const extensionFromName = (value) => {
  const match = value.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? 'mp3';
};

const readPlaylist = async () => {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: 'playlist.json' }));
    const text = await streamToText(result.Body);
    return JSON.parse(text);
  } catch {
    return {
      name: playlistName,
      description: playlistDescription,
      updatedAt: new Date().toISOString(),
      tracks: [],
    };
  }
};

const writePlaylist = async (playlist) => {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: 'playlist.json',
      Body: JSON.stringify(playlist, null, 2),
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'no-store, no-cache, max-age=0, must-revalidate',
    })
  );
};

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'mp3-player-backend',
    date: new Date().toISOString(),
  });
});

app.get('/playlist', async (_req, res) => {
  try {
    const playlist = await readPlaylist();
    res.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
    res.json(playlist);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Playlist okunamadi.',
    });
  }
});

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const token = req.header('x-upload-token');
    if (!token || token !== uploadToken) {
      return res.status(401).json({ error: 'Yetkisiz yukleme denemesi.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Dosya bulunamadi.' });
    }

    const artist = String(req.body.artist || defaultArtist).trim() || defaultArtist;
    const requestedTitle = String(req.body.title || '').trim();
    const duration = String(req.body.duration || '00:00').trim() || '00:00';
    const originalName = req.file.originalname || 'track.mp3';
    const extension = extensionFromName(originalName);
    const title = requestedTitle || titleFromFilename(originalName);
    const id = slugify(`${artist}-${title}-${Date.now()}`) || `track-${Date.now()}`;
    const objectKey = `tracks/${id}.${extension}`;
    const audioUrl = `${publicBaseUrl}/${objectKey}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype || 'application/octet-stream',
      })
    );

    const playlist = await readPlaylist();
    const track = {
      id,
      title,
      artist,
      coverUrl: defaultCoverUrl,
      audioUrl,
      duration,
    };

    playlist.updatedAt = new Date().toISOString();
    playlist.tracks.push(track);
    await writePlaylist(playlist);

    return res.json({
      ok: true,
      track,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Upload sirasinda hata oldu.',
    });
  }
});

app.listen(port, () => {
  console.log(`Backend hazir: http://localhost:${port}`);
});
