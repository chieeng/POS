import { onSnapshot, type DocumentData, type Query } from 'firebase/firestore';
import { useEffect, useState } from 'react';

export interface QueryState<T> {
  data: T[];
  loading: boolean;
  error: boolean;
}

/**
 * Live Firestore query (SRS 7.1). Pass a memoised query, or null to stay idle. Documents are
 * mapped with their id; reads are still subject to Security Rules.
 */
export function useQuerySnapshot<T>(
  query: Query<DocumentData> | null,
  map: (id: string, data: DocumentData) => T,
): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: [], loading: true, error: false });

  useEffect(() => {
    if (!query) return;
    return onSnapshot(
      query,
      (snapshot) => {
        setState({
          data: snapshot.docs.map((doc) => map(doc.id, doc.data())),
          loading: false,
          error: false,
        });
      },
      () => setState({ data: [], loading: false, error: true }),
    );
    // `map` is expected to be a stable module-level function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return state;
}
