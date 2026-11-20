export interface Category { id: string; name: string; createdAt: string; updatedAt: string }
export interface StoredImage { id: string; name: string; type: string; blob: Blob }
export interface Prompt { id: string; categoryId: string; title: string; content: string; images: StoredImage[]; createdAt: string; updatedAt: string }
export interface AppMetadata { key: string; value: string }
export interface PortableImage { id: string; name: string; type: string; dataUrl: string }
export interface PortablePrompt extends Omit<Prompt,'images'> { images: PortableImage[] }
export interface Backup { app: 'Prompt Cloud'; schemaVersion: 1; exportedAt: string; categories: Category[]; prompts: PortablePrompt[] }
