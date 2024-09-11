import { createContext, useContext } from 'react';

type CommentsRefetchContextType = {
    refetchComments: () => void;
    refetchCommentCount: () => void;
};

const CommentsRefetchContext = createContext<CommentsRefetchContextType>({
    refetchComments: () => { return; },
    refetchCommentCount: () => { return; },
});

export const useCommentsRefetch = () => useContext(CommentsRefetchContext);

export default CommentsRefetchContext;