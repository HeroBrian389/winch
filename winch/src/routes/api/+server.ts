import { json } from '@sveltejs/kit';
import busboy from 'busboy';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: request.headers });
    const chunks: Buffer[] = [];

    bb.on('file', (_, file) => {
      file.on('data', (data) => {
        chunks.push(Buffer.from(data));
      });
    });

    bb.on('finish', () => {
      const audioBuffer = Buffer.concat(chunks);
      // Process audioBuffer here
      console.log('Received audio chunk of size:', audioBuffer.length);
      resolve(json({ success: true, message: 'Audio chunk received' }));
    });

    bb.on('error', (error) => {
      console.error('Busboy error:', error);
      reject(json({ success: false, message: 'Error processing audio' }, { status: 500 }));
    });

    (async () => {
      try {
        const arrayBuffer = await request.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        bb.write(buffer);
        bb.end();
      } catch (error) {
        console.error('Error reading request body:', error);
        reject(json({ success: false, message: 'Error reading request body' }, { status: 500 }));
      }
    })();
  });
};