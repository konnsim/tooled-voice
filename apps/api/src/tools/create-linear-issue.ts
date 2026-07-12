import { z } from 'zod';
import { defineTool } from './define-tool.js';

export const createLinearIssue=defineTool({
  name:'createLinearIssue',
  description:'Create a Linear issue in the connected account. The team is optional: omit it to use the account default, and include it only when the user explicitly requests a team override.',
  input:z.object({title:z.string().trim().min(1).max(255),description:z.string().trim().max(20_000).optional(),team:z.string().trim().min(1).max(200).optional()}),
  output:z.object({id:z.string(),identifier:z.string(),title:z.string(),url:z.url(),team:z.string()}),
  permissions:['tools:write'],
  retry:{enabled:false},
  execute(input,context){return context.integrations.linear.createIssue(context.user.id,{title:input.title,...(input.description?{description:input.description}:{}),...(input.team?{team:input.team}:{})},context.signal)},
});
