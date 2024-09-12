"use client";
import { Box, Button, Grid, Group, Space, Stack, Stepper, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconBrandFacebook, IconBrandGoogle } from "@tabler/icons-react";
import Link from "next/link";
import { type MouseEventHandler, useState } from "react";


import { LocationAutocomplete } from "./_components";
import { ErrorAlert } from "../_components/Alerts";
import { Loader } from "../_components/Loader";

import { api } from "~/trpc/react";

export default function Page() {
  const [active, setActive] = useState(0);
  const { mutate: submitRegistration, error: submitError, isError, isLoading, isSuccess } = api.auth.register.useMutation();
  const nextStep: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.preventDefault();
    const stepOneFields = ["firstName", "lastName", "email", "phoneNumber", "location"];
    if (active === 0) {
      let hasErrors = false;
      for (const field of stepOneFields) {
        if (form.validateField(field).hasError) {
          hasErrors = true;
        }
      }
      if (hasErrors) return;
    }
    setActive((current) => (current < 3 ? current + 1 : current));
  };
  const prevStep: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.preventDefault();
    setActive((current) => (current > 0 ? current - 1 : current));
  };
  const form = useForm({
    initialValues: {
      companyName: "",
      email: "",
      facebook: "",
      firstName: "",
      instagram: "",
      lastName: "",
      location: "",
      phoneNumber: "",
      provider: "email",
      tiktok: "",
      twitter: "",
      vimeo: "",
      website: "",
      youtube: "",
    },

    validate: {
      companyName: (value) => value.length > 0 ? null : "Business name is required",
      email: (value) => {
        if (value.length === 0) return "Email is required";
        // regex to confirm valid email
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Invalid email";
        return null;
      },
      facebook: (value) => {
        // regex to confirm valid facebook includes "facebook.com"
        if (value.length && !/^(http|https):\/\/(www.)?facebook.com\/[^ "]+$/.test(value)) return "Invalid Facebook URL";
      },
      firstName: (value) => value.length > 0 ? null : "First name is required",
      instagram: (value) => {
        // regex to confirm valid instagram includes "instagram.com" or "x.com"
        if (value.length && !/^(http|https):\/\/(www.)?instagram.com\/[^ "]+$/.test(value)) return "Invalid Instagram URL";
      },
      lastName: (value) => value.length > 0 ? null : "Last name is required",
      location: (value) => value.length > 0 ? null : "Location is required",
      phoneNumber: (value) => {
        // regex to confirm valid phone number
        if (!/^\d{10}$/.test(value)) return "Invalid phone number";
      },
      tiktok: (value) => {
        // regex to confirm valid tiktok includes "tiktok.com"
        if (value.length && !/^(http|https):\/\/(www.)?tiktok.com\/[^ "]+$/.test(value)) return "Invalid TikTok URL";
      },
      twitter: (value) => {
        // regex to confirm valid twitter includes "twitter.com" or "x.com"
        if (value.length && (!/^(http|https):\/\/(www.)?twitter.com\/[^ "]+$/.test(value) || !/^(http|https):\/\/(www.)?x.com\/[^ "]+$/.test(value))) return "Invalid Twitter URL";
      },
      vimeo: (value) => {
        // regex to confirm valid vimeo includes "vimeo.com"
        if (value.length && !/^(http|https):\/\/(www.)?vimeo.com\/[^ "]+$/.test(value)) return "Invalid Vimeo URL";
      },
      website: (value) => {
        // regex to confirm valid website
        if (value.length && !/^(http|https):\/\/[^ "]+$/.test(value)) return "Invalid website";
      },
      youtube: (value) => {
        // regex to confirm valid youtube includes "youtube.com"
        if (value.length && !/^(http|https):\/\/(www.)?youtube.com\/[^ "]+$/.test(value)) return "Invalid YouTube URL";
      }
    },
  });

  const handleSubmit = () => {
    const validation = form.validate();
    if (validation.hasErrors) {
      return;
    } else {
      submitRegistration({
        companyName: form.values.companyName,
        email: form.values.email,
        facebook: form.values.facebook,
        firstName: form.values.firstName,
        instagram: form.values.instagram,
        lastName: form.values.lastName,
        location: form.values.location,
        phone: form.values.phoneNumber,
        provider: form.values.provider as "email" | "google" | "facebook",
        tiktok: form.values.tiktok,
        twitter: form.values.twitter,
        vimeo: form.values.vimeo,
        website: form.values.website,
        youtube: form.values.youtube,
      });
    }
  };

  if (isLoading) {
    return <Loader />
  }
  if (isSuccess) {
    return <Box p="xl" maw={800}>Registration successful!</Box>
  }
  return (
    <Box p="xl" maw={800}>
      <form onSubmit={handleSubmit}>
        {isError && <ErrorAlert title="Error" message={submitError.message} />}
        <Stepper mt="xl" active={active} onStepClick={setActive} allowNextStepsSelect={false}>
          <Stepper.Step label="Personal Info" description="Enter your personal information">
            <Group grow>
              <TextInput
                label="First Name"
                placeholder="First name"
                required
                {...form.getInputProps("firstName")}
              />
              <TextInput
                label="Last Name"
                placeholder="Last name"
                required
                {...form.getInputProps("lastName")}
              />
            </Group>
            <TextInput
              label="Email"
              placeholder="Email"
              required
              {...form.getInputProps("email")}
            />
            <TextInput
              label="Phone Number"
              placeholder="Phone number"
              required
              {...form.getInputProps("phoneNumber")}
            />
            <LocationAutocomplete
              label="Location"
              placeholder="Location"
              isRequired={true}
              {...form.getInputProps("location")}
            />
          </Stepper.Step>
          <Stepper.Step label="Business Info" description="Enter your business information">
            <TextInput label="Business Name" placeholder="Awesome Photography, LLC" {...form.getInputProps("companyName")} />
            <TextInput label="Website" placeholder="https://awesome-photographer.com" {...form.getInputProps("website")} />
            <Grid grow>
              <Grid.Col span={6}>
                <TextInput label="Facebook" placeholder="https://facebook.com/awesome-photographer" />
                <TextInput label="Instagram" placeholder="https://instagram.com/awesome-photographer" {...form.getInputProps("instagram")} />
                <TextInput label="TikTok" placeholder="https://tiktok.com/awesome-photographer" {...form.getInputProps("tiktok")} />
              </Grid.Col>
              <Grid.Col span={6}>
                <TextInput label="Twitter" placeholder="https://twitter.com/awesome-photographer" {...form.getInputProps("twitter")} />
                <TextInput label="Vimeo" placeholder="https://vimeo.com/awesome-photographer" {...form.getInputProps("vimeo")} />
                <TextInput label="YouTube" placeholder="https://youtube.com/awesome-photographer" {...form.getInputProps("youtube")} />
              </Grid.Col>
            </Grid>
          </Stepper.Step>
        </Stepper>
        <Group justify="flex-end" mt="md">
          {
            active > 0 &&
            <Button onClick={prevStep} variant="subtle">Back</Button>
          }
          {
            active < 1 ?
              <Button onClick={nextStep} variant="outline">Next</Button> :
              <Button type="submit" variant="outline" color="blue">Register</Button>
          }
        </Group>
        <Stack mt="xl" justify="center" w="100%" align="center" >
          <Button
            component="a"
            href="/api/auth/signin"
            w="240"
          >
            <IconBrandGoogle /><Space w="md" /> Sign Up with Google
          </Button>
          <Button
            component="a"
            href="/api/auth/signin"
            w="240"
          >
            <IconBrandFacebook /><Space w="md" /> Sign Up with Facebook
          </Button>

          <span>
            Already have an account?{" "}
            <Link href="/login" style={{
              textDecoration: "underline",
            }}>Login</Link>
          </span>
        </Stack>
      </form>
    </Box>
  )
}