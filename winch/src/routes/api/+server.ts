import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import Groq from 'groq-sdk';
import { Buffer } from 'buffer';

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


    // Fix the WebM chunk
    const fixedBuffer = fixWebMChunk(buffer);

    // Save fixed buffer to a temporary file
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    const tempFilePath = path.join(tempDir, `temp_${Date.now()}.webm`);
    fs.writeFileSync(tempFilePath, fixedBuffer);

    console.log(`Fixed temporary file written: ${tempFilePath}`);
    console.log(`Fixed file size on disk: ${fs.statSync(tempFilePath).size} bytes`);

    // Process audio
    const chunks = await detectSilenceAndSplit(tempFilePath);



    // Transcribe non-silent chunks and check for jokes
    const results = await transcribeAndAnalyzeChunks(chunks);
    
    try {
      fs.unlinkSync(tempFilePath);
      chunks.forEach((chunk) => fs.unlinkSync(chunk));
    } catch (error) {
      console.error('Error cleaning up temporary files:', error);
    }



    return json({ success: true, results });
  } catch (error) {
    console.error('Error processing audio:', error);
    return json({ success: false, message: 'Error processing audio' }, { status: 500 });
  }
};

async function detectSilenceAndSplit(filePath: string): Promise<string[]> {
  const chunks: string[] = [];
  const outputDir = path.join(process.cwd(), 'temp');

  try {
    
    console.log(`Processing file: ${filePath}`);
    console.log(`File size before processing: ${fs.statSync(filePath).size} bytes`);

    const isValidAudio = await diagnoseWebMFile(filePath);
    if (!isValidAudio) {
      throw new Error('Invalid audio file');
    }

    const { stdout, stderr } = await execAsync(
      `ffmpeg -i "${filePath}" -af silencedetect=noise=${SILENCE_THRESHOLD}dB:d=${SILENCE_DURATION} -f null - 2>&1`
    );
    console.log('FFmpeg stdout:', stdout);
    console.log('FFmpeg stderr:', stderr);



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
        model: 'whisper-large-v3',
        language: 'en'
      });
      transcriptions.push(transcription.text);
    } catch (error) {
      console.error('Transcription error:', error);
      transcriptions.push(''); // Push empty string for failed transcriptions
    }
  }

  return transcriptions;
}

async function transcribeAndAnalyzeChunks(
  chunks: string[]
): Promise<Array<{ transcription: string; isJoke: boolean; funniness?: number }>> {
  const results = [];
  let fullTranscription = '';

  // First, transcribe all chunks
  for (const chunk of chunks) {
    try {
      const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(chunk),
        model: 'whisper-large-v3',
        language: 'en'
      });

      fullTranscription += transcription.text + ' ';
      results.push({
        transcription: transcription.text,
        isJoke: false // We'll update this later if it's part of a joke
      });
    } catch (error) {
      console.error('Transcription error:', error);
      results.push({
        transcription: '',
        isJoke: false
      });
    }
  }

  // Now check for a joke in the full transcription
  const jokeCheck = await checkForJoke(fullTranscription.trim());

  if (jokeCheck.isJoke) {
    const funniness = await rateFunniness(fullTranscription.trim());

    // Update all result entries to be part of the joke
    results.forEach((result) => {
      result.isJoke = true;
    });

    // Add funniness to the last entry (you could choose a different approach if needed)
    results[results.length - 1].funniness = funniness;
  }

  return results;
}

async function checkForJoke(text: string): Promise<{ isJoke: boolean }> {
  const chatCompletion = await groq.chat.completions.create({
    messages: [
      {
        role: 'system',
        content:
          "You are an AI trained to detect jokes. Respond with 'true' if the given text contains a joke, and 'false' otherwise."
      },
      {
        role: 'user',
        content: text
      }
    ],
    model: 'llama3-8b-8192',
    temperature: 0.5,
    max_tokens: 10,
    top_p: 1,
    stream: false
  });

  const response = chatCompletion.choices[0]?.message?.content.toLowerCase().trim();
  return { isJoke: response === 'true' };
}

async function rateFunniness(joke: string): Promise<number> {
  const chatCompletion = await groq.chat.completions.create({
    messages: [
      {
        role: 'system',
        content:
          'You are an AI trained to rate jokes. Rate the following joke on a scale of 1-10, where 1 is not funny at all and 10 is extremely funny. Respond with only a number.'
      },
      {
        role: 'user',
        content: joke
      }
    ],
    model: 'llama3-8b-8192',
    temperature: 0.5,
    max_tokens: 10,
    top_p: 1,
    stream: false
  });

  const response = chatCompletion.choices[0]?.message?.content.trim();
  return parseInt(response) || 0;
}



function fixWebMChunk(chunk) {
  const ebmlHeader = Buffer.from([
    0x1A, 0x45, 0xDF, 0xA3, // EBML
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1F, // EBML size (31 bytes)
    0x42, 0x86, 0x81, 0x01, // EBMLVersion = 1
    0x42, 0xF7, 0x81, 0x01, // EBMLReadVersion = 1
    0x42, 0xF2, 0x81, 0x04, // EBMLMaxIDLength = 4
    0x42, 0xF3, 0x81, 0x08, // EBMLMaxSizeLength = 8
    0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6D, // DocType = "webm"
    0x42, 0x87, 0x81, 0x02, // DocTypeVersion = 2
    0x42, 0x85, 0x81, 0x02  // DocTypeReadVersion = 2
  ]);

  const segmentHeader = Buffer.from([
    0x18, 0x53, 0x80, 0x67, // Segment
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, // Segment size (unknown size)
  ]);

  // Check if chunk already has EBML header
  if (chunk.slice(0, 4).toString('hex') !== '1a45dfa3') {
    // Prepend EBML and Segment headers
    return Buffer.concat([ebmlHeader, segmentHeader, chunk]);
  }

  // If the chunk has an EBML header but no Segment header, add the Segment header
  if (chunk.slice(31, 35).toString('hex') !== '18538067') {
    return Buffer.concat([chunk.slice(0, 31), segmentHeader, chunk.slice(31)]);
  }

  return chunk;
}

async function diagnoseWebMFile(filePath) {
  try {
    const { stdout } = await execAsync(`ffprobe -v error -show_entries stream=codec_type -of default=nw=1:nk=1 "${filePath}"`);
    console.log('FFprobe diagnosis:', stdout);
    return stdout.trim() === 'audio';
  } catch (error) {
    console.error('FFprobe diagnosis error:', error);
    return false;
  }
}