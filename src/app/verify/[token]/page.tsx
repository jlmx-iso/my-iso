"use client"
import { useEffect } from "react";

import { UserVerificationErrors } from "~/_types/errors";
import { api } from "~/trpc/react";

export default function Page({ params }: { params: { token: string } }) {
    const { error, isError, isPending, isSuccess, mutate: verifyAccount } = api.auth.verifyAccount.useMutation();
    useEffect(() => {
        verifyAccount({ token: params.token });
    }, [params.token]);

    if (isPending) {
        return <p>Verifying...</p>;
    }

    if (isError) {
        switch (error.message) {
            case UserVerificationErrors.TOKEN_NOT_FOUND:
                return <p>This token is not valid</p>;
            case UserVerificationErrors.TOKEN_EXPIRED:
                return <p>This token has expired. Would you like to <a href="/resend">resend</a>?</p>;
            case UserVerificationErrors.USER_NOT_FOUND:
                return <p>This account has already been verified or no longer exists</p>;
            case UserVerificationErrors.USER_ALREADY_VERIFIED:
                return <p>This account has already been verified</p>;
            default:
                return (
                    <div>
                        <p>Sorry, there was an error verifying your email</p>
                    </div>
                );
        }
    }

    if (isSuccess) {
        return <p>Email verified successfully!</p>;
    }

    return null;
}