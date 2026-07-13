import { describe, expect, it } from 'vitest';
import { toolCallRequestSchema } from '@tooled-voice/shared';
import { getCurrentTime } from './get-current-time.js';
import { realtimeTools, toolRegistry } from './registry.js';
describe('tool registry',()=>{
  it('registers local tools without a switch and exposes JSON schema',()=>{expect(toolRegistry.get('getCurrentTime')).toBe(getCurrentTime);expect(realtimeTools).toHaveLength(1);expect(realtimeTools[0]?.parameters).toMatchObject({type:'object'})});
  it('validates request envelopes and tool arguments',()=>{expect(toolCallRequestSchema.safeParse({callId:'c1',tool:'getCurrentTime',arguments:{timezone:'Australia/Sydney'}}).success).toBe(true);expect(getCurrentTime.input.safeParse({timezone:'Not/AZone'}).success).toBe(false)});
  it('executes the real timezone tool',async()=>{const result=getCurrentTime.output!.parse(await getCurrentTime.execute({timezone:'Australia/Sydney'},{} as never));expect(result).toMatchObject({timezone:'Australia/Sydney'});expect(Date.parse(result.iso)).not.toBeNaN()});
});
