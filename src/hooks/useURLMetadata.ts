import { useState, useEffect } from 'react';
import { fetchURLMetadata, type URLCardMetadata } from '@/services/URLMetadataService';

export function useURLMetadata(url: string | null): URLCardMetadata | null {
  const [metadata, setMetadata] = useState<URLCardMetadata | null>(null);

  useEffect(() => {
    if (!url) {
      setMetadata(null);
      return;
    }
    let cancelled = false;
    fetchURLMetadata(url).then((meta) => {
      if (!cancelled) setMetadata(meta);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return metadata;
}
