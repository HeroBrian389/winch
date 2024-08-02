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

    const randomId = Math.random().toString(36).substring(7);

    const tempFilePath = path.join(tempDir, `temp_${Date.now()}_${randomId}.webm`);
    fs.writeFileSync(tempFilePath, buffer);

    const chunks = [tempFilePath];

    // Transcribe non-silent chunks and check for jokes
    const results = await transcribeAndAnalyzeChunks(chunks);

    console.log(results)

    // Clean up temporary files
    try {
    // fs.unlinkSync(tempFilePath);
    // chunks.forEach(chunk => fs.unlinkSync(chunk));
    } catch (error) {
      console.error('Error cleaning up temporary files:', error);
    }

    return json({ success: true, results });
  } catch (error) {
    console.error('Error processing audio:', error);
    return json({ success: false, message: 'Error processing audio' }, { status: 500 });
  }
};

async function transcribeAndAnalyzeChunks(chunks: string[]): Promise<Array<{transcription: string, isJoke: boolean, funniness?: number}>> {
  const results = [];
  let accumulatedTranscription = '';

  for (const chunk of chunks) {
    try {
      const transcription = await groq.audio.transcriptions.create({
        file: fs.createReadStream(chunk),
        model: "whisper-large-v3",
        language: "en",
      });

      accumulatedTranscription += transcription.text + ' ';

      // Check for jokes in the accumulated transcription
      const jokeCheck = await checkForJoke(accumulatedTranscription);

      if (jokeCheck.isJoke) {
        const funniness = await rateFunniness(accumulatedTranscription);
        results.push({
          transcription: accumulatedTranscription.trim(),
          isJoke: true,
          funniness: funniness
        });
        accumulatedTranscription = ''; // Reset for the next potential joke
      } else {
        results.push({
          transcription: transcription.text,
          isJoke: false
        });
      }
    } catch (error) {
      console.error('Transcription or analysis error:', error);
      results.push({
        transcription: '',
        isJoke: false
      });
    }
  }

  // Check any remaining transcription
  if (accumulatedTranscription.trim()) {
    const jokeCheck = await checkForJoke(accumulatedTranscription);
    if (jokeCheck.isJoke) {
      const funniness = await rateFunniness(accumulatedTranscription);
      results.push({
        transcription: accumulatedTranscription.trim(),
        isJoke: true,
        funniness: funniness
      });
    }
  }

  return results;
}

async function checkForJoke(text: string): Promise<{isJoke: boolean}> {
  const chatCompletion = await groq.chat.completions.create({
    messages: [
      {
        role: "system",
        content: "You are an AI trained to detect jokes. Respond with 'true' if the given text contains a joke, and 'false' otherwise.",
      },
      {
        role: "user",
        content: text,
      },
    ],
    model: "llama3-8b-8192",
    temperature: 0.5,
    max_tokens: 10,
    top_p: 1,
    stream: false,
  });

  const response = chatCompletion.choices[0]?.message?.content.toLowerCase().trim();
  return { isJoke: response === 'true' };
}

async function rateFunniness(joke: string): Promise<number> {
  const chatCompletion = await groq.chat.completions.create({
    messages: [
      {
        role: "system",
        content: "You are an AI trained to rate jokes. Rate the following joke on a scale of 1-10, where 1 is not funny at all and 10 is extremely funny. Respond with only a number.",
      },
      {
        role: "user",
        content: joke,
      },
    ],
    model: "llama3-8b-8192",
    temperature: 0.5,
    max_tokens: 10,
    top_p: 1,
    stream: false,
  });

  const response = chatCompletion.choices[0]?.message?.content.trim();
  return parseInt(response) || 0;
}