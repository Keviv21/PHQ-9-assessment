import { useEffect, useState } from 'react';

// React owns the page structure. Existing assessment controllers own dynamic
// question/report regions and media resources. Navigation uses full page loads
// so each controller has one lifetime and its unload handlers release media.
export function usePageController(title, controllers) {
  const [error, setError] = useState(null);
  useEffect(() => {
    document.title = title;
    let mounted = true;
    Promise.all(controllers.map((load) => load())).catch((cause) => {
      if (mounted) setError(cause);
    });
    return () => { mounted = false; };
  }, [title, controllers]);
  if (error) throw error;
}
