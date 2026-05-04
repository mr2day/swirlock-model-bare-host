export type ModelCapabilities = {
  text: boolean;
  images: boolean;
  thinking: boolean;
};

export type ModelConfig = {
  id: string;
  label: string;
  capabilities: ModelCapabilities;
};

export const DEFAULT_MODEL_ID = 'qwen2.5-coder:14b';

export const MODEL_CONFIGS: ModelConfig[] = [
  {
    id: 'qwen2.5-coder:14b',
    label: 'qwen2.5-coder:14b',
    capabilities: {
      text: true,
      images: false,
      thinking: false,
    },
  },
  {
    id: 'gemma4:e4b',
    label: 'gemma4:e4b',
    capabilities: {
      text: true,
      images: true,
      thinking: true,
    },
  },
  {
    id: 'qwen3.5:9b',
    label: 'qwen3.5:9b',
    capabilities: {
      text: true,
      images: true,
      thinking: true,
    },
  },
];

export const getModelConfig = (modelId: string): ModelConfig | undefined => {
  return MODEL_CONFIGS.find((modelConfig) => modelConfig.id === modelId);
};