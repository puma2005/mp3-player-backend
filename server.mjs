import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
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

const dataDir = path.join(process.cwd(), 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const playlistFile = path.join(dataDir, 'playlist.json');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,
  },
});

app.use(cors());
app.use(express.json());
app.use('/media', express.static(uploadsDir, { fallthrough: false }));

const ensureStorage = async () => {
  await fs.mkdir(uploadsDir, { recursive: true });

  try {
    await fs.access(playlistFile);
  } catch {
    await fs.writeFile(
      playlistFile,
      JSON.stringify(
        {
          name: playlistName,
          description: playlistDescription,
          updatedAt: new Date().toISOString(),
          tracks: [],
        },
        null,
        2
      )
    );
  }
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
  await ensureStorage();
  const text = await fs.readFile(playlistFile, 'utf8');
  return JSON.parse(text);
};

const writePlaylist = async (playlist) => {
  await ensureStorage();
  await fs.writeFile(playlistFile, JSON.stringify(playlist, null, 2));
};

app.get('/health', async (_req, res) => {
  await ensureStorage();
  res.json({
    ok: true,
    service: 'mp3-player-backend',
    storage: 'local',
    date: new Date().toISOString(),
  });
});

app.get('/playlist', async (req, res) => {
  try {
    const playlist = await readPlaylist();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const hydrated = {
      ...playlist,
      tracks: playlist.tracks.map((track) => ({
        ...track,
        audioUrl: `${baseUrl}/${track.audioPath}`,
      })),
    };

    res.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
    res.json(hydrated);
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

    await ensureStorage();

    const artist = String(req.body.artist || defaultArtist).trim() || defaultArtist;
    const requestedTitle = String(req.body.title || '').trim();
    const duration = String(req.body.duration || '00:00').trim() || '00:00';
    const originalName = req.file.originalname || 'track.mp3';
    const extension = extensionFromName(originalName);
    const title = requestedTitle || titleFromFilename(originalName);
    const id = slugify(`${artist}-${title}-${Date.now()}`) || `track-${Date.now()}`;
    const fileName = `${id}.${extension}`;
    const filePath = path.join(uploadsDir, fileName);
    const audioPath = `media/${fileName}`;

    await fs.writeFile(filePath, req.file.buffer);

    const playlist = await readPlaylist();
    const track = {
      id,
      title,
      artist,
      coverUrl: defaultCoverUrl,
      audioPath,
      duration,
    };

    playlist.updatedAt = new Date().toISOString();
    playlist.tracks.push(track);
    await writePlaylist(playlist);

    return res.json({
      ok: true,
      track: {
        ...track,
        audioUrl: `${req.protocol}://${req.get('host')}/${audioPath}`,
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Upload sirasinda hata oldu.',
    });
  }
});

ensureStorage()
  .then(() => {
    app.listen(port, () => {
      console.log(`Backend hazir: http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Depolama hazirlanamadi:', error);
    process.exit(1);
  });
