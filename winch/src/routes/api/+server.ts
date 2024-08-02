import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import Groq from 'groq-sdk';

const execAsync = promisify(exec);


// Ensure you have the GROQ_API_KEY in your environment variables
const groq = new Groq({
  apiKey: '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'
});

// Configuration
const SILENCE_THRESHOLD = -30; // dB
const SILENCE_DURATION = 0.5; // seconds
const MIN_CHUNK_DURATION = 2; // seconds

export const POST: RequestHandler = async ({ request }) => {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return json({ success: false, message: 'No audio file received' }, { status: 400 });
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Save buffer to a temporary file
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    const tempFilePath = path.join(tempDir, `temp_${Date.now()}.webm`);
    fs.writeFileSync(tempFilePath, buffer);

    // Process audio
    const chunks = await detectSilenceAndSplit(tempFilePath);

    console.log(chunks)

    // Transcribe non-silent chunks
    const transcriptions = await transcribeChunks(chunks);

    // Clean up temporary files
    fs.unlinkSync(tempFilePath);
    chunks.forEach(chunk => fs.unlinkSync(chunk));

    return json({ success: true, transcriptions });
  } catch (error) {
    console.error('Error processing audio:', error);
    return json({ success: false, message: 'Error processing audio' }, { status: 500 });
  }
};

async function detectSilenceAndSplit(filePath: string): Promise<string[]> {
  const chunks: string[] = [];
  const outputDir = path.join(process.cwd(), 'temp');

  try {
    const { stdout } = await execAsync(`ffmpeg -i "${filePath}" -af silencedetect=noise=${SILENCE_THRESHOLD}dB:d=${SILENCE_DURATION} -f null - 2>&1`);
    
    const silences = stdout.match(/silence_end: (\d+\.?\d*)/g);
    if (!silences) return chunks;

    let start = 0;
    for (const silence of silences) {
      const end = parseFloat(silence.split(':')[1]);
      if (end - start >= MIN_CHUNK_DURATION) {
        const outputPath = path.join(outputDir, `chunk_${Date.now()}.wav`);
        await execAsync(`ffmpeg -i "${filePath}" -ss ${start} -to ${end} "${outputPath}"`);
        chunks.push(outputPath);
      }
      start = end;
    }

    return chunks;
  } catch (error) {
    console.error('Error in detectSilenceAndSplit:', error);
    return chunks;
  }
}

async function transcribeChunks(chunks: string[]): Promise<string[]> {
  const transcriptions: string[] = [];

  for (const chunk of chunks) {
    try {
      const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(chunk),
        model: "whisper-large-v3",
        language: "en",
      });
      transcriptions.push(transcription.text);
    } catch (error) {
      console.error('Transcription error:', error);
      transcriptions.push(''); // Push empty string for failed transcriptions
    }
  }

  return transcriptions;
}

