import { m } from '$lib/paraglide/messages';

// Contrato com o `code` opcional que os protocolos de sync P2P (sync-files, sync-comic,
// sync-history, browse-library, browse-cover) anexam ao payload de `*:error` quando a causa
// tem uma tradução estável (ver `classify_sync_error`/`SyncErrorCode` em `transfer.rs`) — o
// `message` cru continua em inglês/técnico (log/wire, às vezes texto de baixo nível do QUIC
// tipo "stream reset by peer"), então sem isso esses erros apareceriam sem tradução na UI
// mesmo com o app todo em pt-BR. Código não reconhecido (`classify_sync_error` retornou
// `None`) cai no fallback natural de `translateSyncMessage` — mostra o `message` cru, mesmo
// padrão de `errors.i18n.ts` pros erros de `ComicError`. Compartilhado por todos os hooks que
// escutam eventos `*:error` desses protocolos (`use-network-sync.svelte.ts`,
// `use-remote-library.svelte.ts`) — mesmo `code` em todos, um lugar só pra traduzir.
const SYNC_ERROR_MESSAGES: Record<string, () => string> = {
	busy: m['tauriErrors.sync.sessionBusy.label'],
	timeout: m['tauriErrors.sync.timedOut.label'],
	connection_lost: m['tauriErrors.sync.connectionLost.label'],
	peer_not_found: m['tauriErrors.sync.peerNotFound.label'],
	auth_denied: m['tauriErrors.sync.authDenied.label'],
	shutdown: m['tauriErrors.sync.shutdown.label'],
	incompatible_version: m['tauriErrors.sync.incompatibleVersion.label'],
	startup_failed: m['tauriErrors.sync.startup.failed.label'],
	blob_not_found: m['tauriErrors.sync.blob.notFound.label'],
	missing_blob_hash: m['tauriErrors.sync.missingBlobHash.label'],
	blob_fetch_failed: m['tauriErrors.sync.blob.fetchFailed.label'],
	checksum_mismatch: m['tauriErrors.sync.checksumMismatch.label'],
	comic_directory_unavailable: m['tauriErrors.sync.comic.directoryUnavailable.label'],
	persist_failed: m['tauriErrors.sync.persist.failed.label'],
	no_pending_request: m['tauriErrors.sync.noPendingRequest.label'],
	partial_sync: m['tauriErrors.sync.partialSync.label'],
	comic_not_found: m['tauriErrors.sync.comic.notFound.label']
};

export function translateSyncMessage(code: string | undefined, message: string): string {
	return (code && SYNC_ERROR_MESSAGES[code]?.()) ?? message;
}
