import { isLibraryEntryMetadataV01, type LibraryEntryMetadataV01, type LibraryEntryMetadataUpdateV01 } from "@vua/contracts";
import { createGatewayClient, type GatewayClient } from "./gateway-client.ts";
export class LibraryMetadataError extends Error { constructor(readonly code: string) { super(code); } }
export interface LibraryMetadataPort {
  read(entryId: string): Promise<LibraryEntryMetadataV01>;
  update(params: LibraryEntryMetadataUpdateV01, commandId: string): Promise<LibraryEntryMetadataV01>;
}
export function createLibraryMetadataPort(client: GatewayClient = createGatewayClient(typeof window === "undefined" ? undefined : window.vua)): LibraryMetadataPort {
  return {
    async read(entryId) {
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "library.entryMetadata", params: { schemaVersion: "0.1", entryId } });
      if (!response.ok) throw new LibraryMetadataError(response.error.kind === "application" ? response.error.error.code : "read_failed");
      if (!isLibraryEntryMetadataV01(response.value) || response.value.entryId !== entryId) throw new LibraryMetadataError("read_failed");
      return response.value;
    },
    async update(params, commandId) {
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "library.updateEntryMetadata", params: { ...params, commandId } });
      if (!response.ok) throw new LibraryMetadataError(response.error.kind === "application" ? response.error.error.code : "write_failed");
      if (!isLibraryEntryMetadataV01(response.value) || response.value.entryId !== params.entryId || response.value.revision !== params.expectedRevision + 1) throw new LibraryMetadataError("write_failed");
      return response.value;
    },
  };
}
