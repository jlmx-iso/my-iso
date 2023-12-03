import Image from "next/image";
import { getServerAuthSession } from "~/server/auth";

// import { useRouter } from "next/navigation";
// import { useState } from "react";

// import { api } from "~/trpc/react";

export async function CreatePost() {
  const session = await getServerAuthSession();
  // const router = useRouter();
  // const [name, setName] = useState("");

  // const createPost = api.post.create.useMutation({
  //   onSuccess: () => {
  //     router.refresh();
  //     setName("");
  //   },
  // });
  if (!session) return (
    <Image
      src="/images/nextjs.svg"
      alt="Next.js Logo"
      width={500}
      height={500}
    />
  );

  return (
    <Image
      src={session.user.profilePic ?? ""}
      alt={`Profile Photo of ${session.user.name}`}
      width={500}
      height={500}
    />
    // <form
    //   onSubmit={(e) => {
    //     e.preventDefault();
    //     createPost.mutate({ name });
    //   }}
    //   className="flex flex-col gap-2"
    // >
    //   <input
    //     type="text"
    //     placeholder="Title"
    //     value={name}
    //     onChange={(e) => setName(e.target.value)}
    //     className="w-full rounded-full px-4 py-2 text-black"
    //   />
    //   <button
    //     type="submit"
    //     className="rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20"
    //     disabled={createPost.isLoading}
    //   >
    //     {createPost.isLoading ? "Submitting..." : "Submit"}
    //   </button>
    // </form>
  );
}
