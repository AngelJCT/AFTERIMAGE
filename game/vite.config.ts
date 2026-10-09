import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { REFERENCES } from './src/dev/referenceCatalog.ts';

/** An allowlist of source artwork, available locally without adding it to the game download. */
function references(): Plugin {
  return {
    name: 'afterimage-references', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__reference', (req, res) => {
        const id = new URL(req.url ?? '', 'http://localhost').searchParams.get('id') ?? '';
        const ref = Object.hasOwn(REFERENCES, id) ? REFERENCES[id as keyof typeof REFERENCES] : null;
        const file = ref && resolve(__dirname, '..', ref.file);
        if (!file || !existsSync(file)) { res.statusCode = 404; res.end('Reference not found'); return; }
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).on('error', () => { res.destroy(); }).pipe(res);
      });
    },
  };
}

/**
 * Dev only: POST /__shot?name=x with a JPEG data URL body writes .shots/x.jpg, so scripted
 * checks can grab frames from a hidden browser tab (see src/debug.ts __save).
 */
function shots(): Plugin {
  return {
    name: 'afterimage-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'shot').replace(/[^\w-]/g, '');
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const dir = resolve(__dirname, '.shots');
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${name}.jpg`), Buffer.from(body.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

/**
 * Dev only, for the trailer tool (src/trailer.ts):
 *   POST /__frame?take=x&i=n   a JPEG data URL -> .trailer/x/f00000.jpg (i = 0 clears the take)
 *   POST /__encode?take=x&fps=30&crf=19&ss=0&music=audio/y.mp3   ffmpeg the frames (the music from ss s) (and the music, faded
 *        out at the end) into .trailer/x.mp4; answers with the path or ffmpeg's error.
 */
function trailer(): Plugin {
  const root = resolve(__dirname, '.trailer');
  const take = (req: { url?: string }) => {
    const q = new URL(req.url ?? '', 'http://x').searchParams;
    return { q, name: (q.get('take') ?? 'trailer').replace(/[^\w-]/g, '') };
  };
  return {
    name: 'afterimage-trailer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__frame', (req, res) => {
        const { q, name } = take(req);
        const i = Number(q.get('i') ?? 0);
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const dir = resolve(root, name);
          if (i === 0 && existsSync(dir)) rmSync(dir, { recursive: true });
          mkdirSync(dir, { recursive: true });
          const body = Buffer.concat(chunks).toString();
          writeFileSync(resolve(dir, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(body.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
          res.end('ok');
        });
      });
      server.middlewares.use('/__encode', (req, res) => {
        const { q, name } = take(req);
        const fps = Number(q.get('fps') ?? 30);
        // 19 keeps the grain without a huge file (~70 MB a minute); lower is finer and bigger.
        const crf = String(Math.max(0, Math.min(40, Number(q.get('crf') ?? 19))));
        const dir = resolve(root, name);
        const frames = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jpg')).length : 0;
        if (!frames) { res.statusCode = 400; res.end('no frames'); return; }
        const seconds = frames / fps;
        const music = q.get('music');
        const audio = music ? resolve(__dirname, 'public', music.replace(/^\/+/, '')) : '';
        const out = resolve(root, `${name}.mp4`);
        const args = ['-y', '-framerate', String(fps), '-i', resolve(dir, 'f%05d.jpg')];
        if (audio && existsSync(audio)) {
          const fade = Math.max(0, seconds - 3);
          const ss = Math.max(0, Number(q.get('ss') ?? 0));
          if (ss > 0) args.push('-ss', ss.toFixed(3));
          args.push('-i', audio, '-af', `afade=t=in:d=0.6,afade=t=out:st=${fade.toFixed(2)}:d=3`, '-c:a', 'aac', '-b:a', '256k', '-shortest');
        }
        args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
        const ff = spawn('ffmpeg', args);
        let err = '';
        ff.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
        ff.on('error', (e) => { res.statusCode = 500; res.end(String(e)); });
        ff.on('close', (code) => {
          if (code === 0) res.end(out);
          else { res.statusCode = 500; res.end(err); }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [shots(), trailer(), references()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 5180, strictPort: true },
});
