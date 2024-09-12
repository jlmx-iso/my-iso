import { type CSSProperties, Container } from "@mantine/core";
import Image from "next/image";

import { type Resource } from "../../_lib";

export const HeroImage = ({ imageResources }: { imageResources: Resource[] }) => {
    return (
        <Container fluid h={360} pos="relative" className="w-full" >
            {imageResources.length ? imageResources.map(image => {
                // image should take full width of container, max height of 360px, and be centered
                const imageStyle: CSSProperties = {
                    objectFit: "cover",
                };
                return <Image src={image.secure_url} key={image.public_id} alt="" fill={true} style={imageStyle} className="object-contain" />;
            }) : null}
        </Container>
    )
}