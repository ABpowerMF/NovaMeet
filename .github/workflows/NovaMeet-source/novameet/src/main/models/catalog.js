// Every model NovaMeet can install with one click.
// Speech models come from the sherpa-onnx GitHub releases; report models are
// GGUF files from Hugging Face run by llama.cpp (node-llama-cpp), or any model
// in a local Ollama install.
'use strict';

const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

/** Small files every speech model needs: voice activity + speaker identification. */
const VOICE_ESSENTIALS = {
  id: 'voice-essentials',
  kind: 'essentials',
  name: 'Voice essentials',
  role: 'Speaker identification',
  desc: 'Detects speech and tells participants apart. Installed automatically with any speech model.',
  sizeMb: 37,
  downloads: [
    { url: `${SHERPA}/asr-models/silero_vad.onnx`, file: 'silero_vad.onnx' },
    { url: `${SHERPA}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`, extract: true },
    { url: `${SHERPA}/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx`, file: 'speaker-embedding.onnx' }
  ],
  files: {
    vad: 'silero_vad.onnx',
    segmentation: 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx',
    embedding: 'speaker-embedding.onnx'
  }
};

const SPEECH = [
  {
    id: 'parakeet-v3',
    kind: 'speech',
    engine: 'transducer',
    name: 'Parakeet v3',
    role: 'Speech to text',
    desc: 'Fast and very accurate. 25 European languages including English, Portuguese, Spanish, French and German.',
    sizeMb: 487,
    languages: 'European languages',
    badge: 'Recommended',
    downloads: [{ url: `${SHERPA}/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`, extract: true }],
    files: {
      encoder: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/encoder.int8.onnx',
      decoder: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/decoder.int8.onnx',
      joiner: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/joiner.int8.onnx',
      tokens: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/tokens.txt'
    }
  },
  {
    id: 'whisper-turbo',
    kind: 'speech',
    engine: 'whisper',
    name: 'Whisper Large v3 Turbo',
    role: 'Speech to text',
    desc: 'OpenAI Whisper. 99 languages and automatic language detection. Slower than Parakeet.',
    sizeMb: 564,
    languages: '99 languages',
    downloads: [{ url: `${SHERPA}/asr-models/sherpa-onnx-whisper-turbo.tar.bz2`, extract: true }],
    files: {
      encoder: 'sherpa-onnx-whisper-turbo/turbo-encoder.int8.onnx',
      decoder: 'sherpa-onnx-whisper-turbo/turbo-decoder.int8.onnx',
      tokens: 'sherpa-onnx-whisper-turbo/turbo-tokens.txt'
    }
  },
  {
    id: 'moonshine-base',
    kind: 'speech',
    engine: 'moonshine',
    name: 'Moonshine Base',
    role: 'Speech to text',
    desc: 'Tiny and quick. English only — good for older laptops.',
    sizeMb: 251,
    languages: 'English',
    downloads: [{ url: `${SHERPA}/asr-models/sherpa-onnx-moonshine-base-en-int8.tar.bz2`, extract: true }],
    files: {
      preprocessor: 'sherpa-onnx-moonshine-base-en-int8/preprocess.onnx',
      encoder: 'sherpa-onnx-moonshine-base-en-int8/encode.int8.onnx',
      uncachedDecoder: 'sherpa-onnx-moonshine-base-en-int8/uncached_decode.int8.onnx',
      cachedDecoder: 'sherpa-onnx-moonshine-base-en-int8/cached_decode.int8.onnx',
      tokens: 'sherpa-onnx-moonshine-base-en-int8/tokens.txt'
    }
  }
];

// Report models: the Hugging Face URI is resolved by node-llama-cpp, which
// picks the right file for the quantization and shows real download sizes.
const REPORT = [
  {
    id: 'qwen3-4b',
    kind: 'report',
    name: 'Qwen3 4B Instruct',
    role: 'Report',
    desc: 'Light and quick. Good reports on any modern laptop.',
    sizeMb: 2500,
    minMemoryGb: 6,
    uri: 'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M',
    contextSize: 32768
  },
  {
    id: 'gemma3-12b',
    kind: 'report',
    name: 'Gemma 3 12B',
    role: 'Report',
    desc: 'Careful, well-written reports. Needs a GPU with 10 GB or more for good speed.',
    sizeMb: 7300,
    minMemoryGb: 10,
    uri: 'hf:unsloth/gemma-3-12b-it-GGUF:Q4_K_M',
    contextSize: 32768
  },
  {
    id: 'qwen3-30b',
    kind: 'report',
    name: 'Qwen3 30B A3B Instruct',
    role: 'Report',
    desc: 'The most thorough reports. Fast on high-end GPUs (24 GB+).',
    sizeMb: 18600,
    minMemoryGb: 22,
    uri: 'hf:unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF:Q4_K_M',
    contextSize: 65536
  }
];

/** Suggested Ollama models (pulled with one click when Ollama is installed). */
const OLLAMA_SUGGESTED = ['qwen3:8b', 'gemma3:12b', 'qwen3:30b'];

function all() { return [VOICE_ESSENTIALS, ...SPEECH, ...REPORT]; }
function byId(id) { return all().find((m) => m.id === id) || null; }

module.exports = { VOICE_ESSENTIALS, SPEECH, REPORT, OLLAMA_SUGGESTED, all, byId };
