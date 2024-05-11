// import { api } from "~/trpc/server";

import { Container, Stack } from "@mantine/core";
import { getAssetInfo } from "~/app/_lib";
import Image from "next/image";

export default async function Page({ params }: { params: { username: string; }; }) {
  // const photographer = await api.photographer.getByUsername.query({ username: params.username });
  // mock photographer until we have data
  const photographer = { id: "123" };
  const myImage = await getAssetInfo('sample');

  console.log({ myImage });

  if (!photographer) {
    return (
      <div>
        <h1>Photographer not found</h1>
      </div>
    );
  };

  const heroImage = myImage?.secure_url ? <Image src={myImage.secure_url} alt="" fill={true} className="object-contain"  /> : null;
  return (
    // hero image
    // bookmark icon
    // photographer name
    // photographer location
    // photographer bio

    // Details
    // photographer website
    // photographer social media
    // photographer profile image

    // Gear

    // Call to action

    <Stack className="w-full">
      {/* Hero Image */}
      <Container fluid h={360} pos="relative" className="w-full" >
        {heroImage}
      </Container>

      {/* Photographer Name */}
      <h1>{photographer.id}</h1>

    </Stack>
  )
}