import 'dotenv/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import express from 'express';
import cors from 'cors';
import multer from 'multer';

const app = express();
const port = Number(process.env.PORT || 8080);
const uploadToken = process.env.UPLOAD_TOKEN || 'serkan2026yukle';
const defaultArtist = process.env.DEFAULT_ARTIST || 'Serkan Saver';
const defaultCoverUrl =
  process.env.DEFAULT_COVER_URL ||
  'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=600&q=80';
const playlistName = process.env.PLAYLIST_NAME || 'Serkan Saver 2026';
const playlistDescription = process.env.PLAYLIST_DESCRIPTION || 'Serkan Saver parcalarinin online listesi.';
const bucketName = process.env.R2_BUCKET_NAME || 'mp3-player-assets';
const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const accountId = process.env.R2_ACCOUNT_ID || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const playlistKey = process.env.R2_PLAYLIST_KEY || 'playlist.json';
const tracksPrefix = process.env.R2_TRACKS_PREFIX || 'tracks/';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,
  },
});

app.use(cors());
app.use(express.json());

const requiredEnv = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BASE_URL'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

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

const streamToString = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const getAudioUrl = (key) => `${publicBaseUrl}/${key}`;

const basePlaylist = () => ({
  name: playlistName,
  description: playlistDescription,
  updatedAt: new Date().toISOString(),
  tracks: [],
});

const readPlaylist = async () => {
  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: playlistKey,
      })
    );

    const text = await streamToString(response.Body);
    return JSON.parse(text);
  } catch (error) {
    const code = error?.Code || error?.name;
    if (code === 'NoSuchKey' || code === 'NotFound') {
      return basePlaylist();
    }
    throw error;
  }
};

const writePlaylist = async (playlist) => {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: playlistKey,
      Body: JSON.stringify(playlist, null, 2),
      ContentType: 'application/json; charset=utf-8',
    })
  );
};

const listTrackKeys = async () => {
  const response = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: tracksPrefix,
    })
  );

  return (response.Contents || [])
    .map((item) => item.Key)
    .filter((key) => key && key !== tracksPrefix && !key.endsWith('/'))
    .filter((key) => !key.endsWith('.gitkeep'));
};

const objectExists = async (key) => {
  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
    return true;
  } catch (error) {
    const code = error?.Code || error?.name;
    if (code === 'NotFound' || code === 'NoSuchKey') {
      return false;
    }
    throw error;
  }
};

const syncPlaylist = async () => {
  const playlist = await readPlaylist();
  const objectKeys = await listTrackKeys();
  const objectKeySet = new Set(objectKeys);
  const trackByPath = new Map(playlist.tracks.map((track) => [track.audioPath, track]));
  const nextTracks = [];

  for (const track of playlist.tracks) {
    if (track.audioPath && objectKeySet.has(track.audioPath)) {
      nextTracks.push(track);
    }
  }

  for (const key of objectKeys) {
    if (trackByPath.has(key)) continue;

    const fileName = key.split('/').pop() || key;
    const inferredTitle = titleFromFilename(fileName);
    nextTracks.push({
      id: slugify(inferredTitle) || `track-${Date.now()}`,
      title: inferredTitle,
      artist: defaultArtist,
      coverUrl: defaultCoverUrl,
      audioPath: key,
      duration: '00:00',
    });
  }

  const changed =
    nextTracks.length !== playlist.tracks.length ||
    nextTracks.some((track, index) => playlist.tracks[index]?.audioPath !== track.audioPath);

  if (changed) {
    playlist.tracks = nextTracks;
    playlist.updatedAt = new Date().toISOString();
    await writePlaylist(playlist);
  }

  return {
    ...playlist,
    tracks: playlist.tracks.map((track) => ({
      ...track,
      audioUrl: getAudioUrl(track.audioPath),
    })),
  };
};

app.get('/health', async (_req, res) => {
  try {
    if (missingEnv.length) {
      return res.status(500).json({
        ok: false,
        error: `Eksik env: ${missingEnv.join(', ')}`,
      });
    }

    await s3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        MaxKeys: 1,
      })
    );

    return res.json({
      ok: true,
      service: 'mp3-player-backend',
      storage: 'r2',
      bucket: bucketName,
      date: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Saglik kontrolu basarisiz.',
    });
  }
});

app.get('/playlist', async (_req, res) => {
  try {
    const playlist = await syncPlaylist();
    res.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
    return res.json(playlist);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Playlist okunamadi.',
    });
  }
});

app.delete('/tracks/:id', async (req, res) => {
  try {
    const token = req.header('x-upload-token');
    if (!token || token !== uploadToken) {
      return res.status(401).json({ error: 'Yetkisiz silme denemesi.' });
    }

    const playlist = await readPlaylist();
    const trackIndex = playlist.tracks.findIndex((track) => track.id === req.params.id);
    if (trackIndex === -1) {
      return res.status(404).json({ error: 'Sarki bulunamadi.' });
    }

    const [track] = playlist.tracks.splice(trackIndex, 1);
    if (track?.audioPath) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: track.audioPath,
        })
      );
    }

    playlist.updatedAt = new Date().toISOString();
    await writePlaylist(playlist);

    return res.json({
      ok: true,
      removedId: req.params.id,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Silme sirasinda hata oldu.',
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
    const fileName = `${id}.${extension}`;
    const objectKey = `${tracksPrefix}${fileName}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype || 'audio/mpeg',
      })
    );

    const playlist = await readPlaylist();
    const track = {
      id,
      title,
      artist,
      coverUrl: defaultCoverUrl,
      audioPath: objectKey,
      duration,
    };

    playlist.updatedAt = new Date().toISOString();
    playlist.tracks = playlist.tracks.filter((item) => item.id !== track.id && item.audioPath !== objectKey);
    playlist.tracks.push(track);
    await writePlaylist(playlist);

    return res.json({
      ok: true,
      track: {
        ...track,
        audioUrl: getAudioUrl(objectKey),
      },
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
