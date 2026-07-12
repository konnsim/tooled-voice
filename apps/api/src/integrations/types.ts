export interface CreateLinearIssueInput { title:string; description?:string; team?:string }
export interface CreatedLinearIssue { id:string; identifier:string; title:string; url:string; team:string }
export interface LinearIntegration {
  createIssue(userId:string,input:CreateLinearIssueInput,signal:AbortSignal):Promise<CreatedLinearIssue>;
}
export interface IntegrationServices { linear:LinearIntegration }
