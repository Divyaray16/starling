declare module "libheif-js/wasm-bundle.js" {
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      callback: (
        result: { data: Uint8ClampedArray; width: number; height: number } | null,
      ) => void,
    ): void;
  }

  export interface HeifDecoder {
    decode(buffer: Uint8Array): HeifImage[];
  }

  const libheif: {
    HeifDecoder: new () => HeifDecoder;
  };

  export default libheif;
}
