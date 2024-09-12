import { createContext, useContext } from 'react';

type CommentsRefetchContextType = {
    refetchComments: () => void;
    refetchCommentCount: () => void;
};

const CommentsRefetchContext = createContext<CommentsRefetchContextType>({
    refetchCommentCount: () => { return; },
    refetchComments: () => { return; },
});

export const useCommentsRefetch = () => useContext(CommentsRefetchContext);

export default CommentsRefetchContext;