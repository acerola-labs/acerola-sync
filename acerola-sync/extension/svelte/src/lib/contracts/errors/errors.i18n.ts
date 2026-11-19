import * as m from '$lib/paraglide/messages';
import type { ErrorPayload } from '$lib/contracts/shared/shared.payloads';

// Contrato entre os tipos de erro do Rust (ComicError) e as mensagens do Paraglide.
// A chave é o valor exato do campo `errorType` vindo do payload do evento Tauri.
export const COMIC_ERROR_MESSAGES: Record<string, () => string> = {
	AlreadyExists: m['tauriErrors.comic.alreadyExists.label'],
	SyncInProgress: m['tauriErrors.comic.syncIn.progress.label'],
	NotFound: m['tauriErrors.comic.notFound.label'],
	InvalidRequest: m['tauriErrors.comic.invalidRequest.label'],
	IntegrityViolation: m['tauriErrors.comic.integrityViolation.label'],
	SystemFailure: m['tauriErrors.comic.systemFailure.label'],
	Io: m['tauriErrors.comic.io.error.label']
};

// Resolve a mensagem traduzida a partir do payload de erro.
// Usa o `message` técnico do Rust como fallback se o tipo não estiver mapeado.
export function resolveErrorMessage(payload: ErrorPayload): string {
	return COMIC_ERROR_MESSAGES[payload.errorType]?.() ?? payload.message;
}
