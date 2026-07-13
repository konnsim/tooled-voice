import { z } from 'zod';
import type { RegisteredToolDefinition } from './define-tool.js';
import { getCurrentTime } from './get-current-time.js';
export const tools = [getCurrentTime] as const;
export const toolRegistry = new Map(tools.map(tool => [tool.name, tool as unknown as RegisteredToolDefinition]));
export const realtimeTools = tools.map(tool => ({ type:'function' as const, name:tool.name, description:tool.description, parameters:z.toJSONSchema(tool.input, { target: 'draft-7' }) }));
