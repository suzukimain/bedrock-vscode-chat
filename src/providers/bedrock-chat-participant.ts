import * as vscode from "vscode";
import { ConfigurationService } from "../services/configuration.service";
import { AuthenticationService } from "../services/authentication.service";
import { logger } from "../logger";

export class BedrockChatParticipant {
	constructor(
		private readonly configService: ConfigurationService,
		private readonly authService: AuthenticationService
	) {}

	async handleRequest(
		request: vscode.ChatRequest,
		context: vscode.ChatContext,
		progress: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<void> {
		// 2. workspaceチェック
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			progress.report(new vscode.LanguageModelTextPart("No workspace open. Please open a folder to use file editing tools."));
			return;
		}

		try {
			// Select a Bedrock model
			const models = await vscode.lm.selectChatModels({ vendor: "bedrock", family: "bedrock" });
			if (models.length === 0) {
				progress.report(new vscode.LanguageModelTextPart("No Bedrock models available. Please check your configuration."));
				return;
			}
			const model = models[0];

			// 3. edit tool有効化
			const tools: vscode.LanguageModelChatTool[] = [
				{
					name: "file_read",
					description: "Read the content of a file in the workspace",
					inputSchema: {
						type: "object",
						properties: {
							path: { type: "string", description: "Relative path to the file from workspace root" }
						},
						required: ["path"]
					}
				},
				{
					name: "file_write",
					description: "Write content to a file in the workspace",
					inputSchema: {
						type: "object",
						properties: {
							path: { type: "string", description: "Relative path to the file from workspace root" },
							content: { type: "string", description: "Full content to write to the file" }
						},
						required: ["path", "content"]
					}
				},
				{
					name: "file_apply_patch",
					description: "Apply a patch/diff to a file in the workspace",
					inputSchema: {
						type: "object",
						properties: {
							path: { type: "string", description: "Relative path to the file from workspace root" },
							patch: { type: "string", description: "The patch to apply (unified diff format)" }
						},
						required: ["path", "patch"]
					}
				}
			];

			const messages: vscode.LanguageModelChatMessage[] = [
				vscode.LanguageModelChatMessage.User(request.prompt)
			];

			// History integration
			for (const past of context.history) {
				if (past instanceof vscode.ChatRequest) {
					messages.push(vscode.LanguageModelChatMessage.User(past.prompt));
				} else if (past instanceof vscode.ChatResponse) {
					// Convert past response parts back to messages if needed
					// For simplicity, we skip complex history here but in a real app we'd map parts
				}
			}

			let toolCallsHandled = 0;
			const MAX_TOOL_TURNS = 10;

			while (toolCallsHandled < MAX_TOOL_TURNS) {
				const response = await model.sendRequest(messages, { tools }, token);
				let hasToolCall = false;
				let responseText = "";

				for await (const part of response.stream) {
					if (part instanceof vscode.LanguageModelTextPart) {
						progress.report(part);
						responseText += part.value;
					} else if (part instanceof vscode.LanguageModelToolCallPart) {
						hasToolCall = true;
						
						// Report that we are using a tool
						progress.report(new vscode.ChatResponseProgressPart(`Using tool: ${part.name}`));
						
						try {
							const result = await this.executeTool(part.name, part.input as any);
							messages.push(vscode.LanguageModelChatMessage.Assistant([part]));
							messages.push(vscode.LanguageModelChatMessage.User([new vscode.LanguageModelToolResultPart(part.callId, [new vscode.LanguageModelTextPart(result)])]));
						} catch (e) {
							const errorMsg = e instanceof Error ? e.message : String(e);
							messages.push(vscode.LanguageModelChatMessage.Assistant([part]));
							messages.push(vscode.LanguageModelChatMessage.User([new vscode.LanguageModelToolResultPart(part.callId, [new vscode.LanguageModelTextPart(`Error: ${errorMsg}`)])]));
						}
						
						toolCallsHandled++;
					}
				}

				if (!hasToolCall) {
					break;
				}
			}

		} catch (err) {
			logger.error("[Bedrock Agent] Request failed", err);
			progress.report(new vscode.LanguageModelTextPart(`Error: ${err instanceof Error ? err.message : String(err)}`));
		}
	}

	private async executeTool(name: string, input: any): Promise<string> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error("No workspace open");
		}
		const root = workspaceFolders[0].uri;

		switch (name) {
			case "file_read": {
				const uri = vscode.Uri.joinPath(root, input.path);
				const data = await vscode.workspace.fs.readFile(uri);
				return Buffer.from(data).toString("utf8");
			}
			case "file_write": {
				// 1. & 4. FileSystem write許可 & path制限解除
				const uri = vscode.Uri.joinPath(root, input.path);
				const data = Buffer.from(input.content, "utf8");
				await vscode.workspace.fs.writeFile(uri, data);
				return `Successfully wrote to ${input.path}`;
			}
			case "file_apply_patch": {
				// Simple patch implementation (or message that full diff isn't supported yet)
				// For a real implementation, we'd use a library like 'diff'
				return `Patch application requested for ${input.path}. (Implementation pending robust diff library)`;
			}
			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	}
}
