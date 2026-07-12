import { afterEach,describe,expect,it,vi } from 'vitest';
import { logger } from './logger.js';

afterEach(()=>vi.restoreAllMocks());
describe('logger',()=>{it('redacts nested credentials and authorization values',()=>{const output=vi.spyOn(console,'info').mockImplementation(()=>undefined);logger.info({authorization:'Bearer access-secret',integration:{refreshToken:'refresh-secret',safe:'value'}},'Test log');const serialized=String(output.mock.calls[0]?.[0]);expect(serialized).not.toContain('access-secret');expect(serialized).not.toContain('refresh-secret');expect(serialized).toContain('"safe":"value"');expect(serialized).toContain('[REDACTED]')})});
