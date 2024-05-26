"use client";
import { type MouseEventHandler, useState } from "react";
import { TextInput, Button, Box, Group, Stepper, Grid, Stack, Space } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconBrandFacebook, IconBrandGoogle } from "@tabler/icons-react";
import Link from "next/link";
import { api } from "~/trpc/react";
import { LocationAutocomplete } from "./_components";
import { ErrorAlert, Loader } from "../_components";

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
      firstName: "",
      lastName: "",
      email: "",
      phoneNumber: "",
      provider: "email",
      companyName: "",
      website: "",
      twitter: "",
      instagram: "",
      facebook: "",
      youtube: "",
      tiktok: "",
      vimeo: "",
      location: "",
    },

    validate: {
      firstName: (value) => value.length > 0 ? null : "First name is required",
      lastName: (value) => value.length > 0 ? null : "Last name is required",
      email: (value) => {
        if (value.length === 0) return "Email is required";
        // regex to confirm valid email
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Invalid email";
        return null;
      },
      phoneNumber: (value) => {
        // regex to confirm valid phone number
        if (!/^\d{10}$/.test(value)) return "Invalid phone number";
      },
      location: (value) => value.length > 0 ? null : "Location is required",
      companyName: (value) => value.length > 0 ? null : "Business name is required",
      website: (value) => {
        // regex to confirm valid website
        if (value.length && !/^(http|https):\/\/[^ "]+$/.test(value)) return "Invalid website";
      },
      twitter: (value) => {
        // regex to confirm valid twitter includes "twitter.com" or "x.com"
        if (value.length && (!/^(http|https):\/\/(www.)?twitter.com\/[^ "]+$/.test(value) || !/^(http|https):\/\/(www.)?x.com\/[^ "]+$/.test(value))) return "Invalid Twitter URL";
      },
      instagram: (value) => {
        // regex to confirm valid instagram includes "instagram.com" or "x.com"
        if (value.length && !/^(http|https):\/\/(www.)?instagram.com\/[^ "]+$/.test(value)) return "Invalid Instagram URL";
      },
      facebook: (value) => {
        // regex to confirm valid facebook includes "facebook.com"
        if (value.length && !/^(http|https):\/\/(www.)?facebook.com\/[^ "]+$/.test(value)) return "Invalid Facebook URL";
      },
      tiktok: (value) => {
        // regex to confirm valid tiktok includes "tiktok.com"
        if (value.length && !/^(http|https):\/\/(www.)?tiktok.com\/[^ "]+$/.test(value)) return "Invalid TikTok URL";
      },
      vimeo: (value) => {
        // regex to confirm valid vimeo includes "vimeo.com"
        if (value.length && !/^(http|https):\/\/(www.)?vimeo.com\/[^ "]+$/.test(value)) return "Invalid Vimeo URL";
      },
      youtube: (value) => {
        // regex to confirm valid youtube includes "youtube.com"
        if (value.length && !/^(http|https):\/\/(www.)?youtube.com\/[^ "]+$/.test(value)) return "Invalid YouTube URL";
      }
    },
  });

  const handleSubmit = () => {
    console.log("Submitting form", form.values)
    const validation = form.validate();
    if (validation.hasErrors) {
      console.log("Validation errors", validation.errors);
      return;
    } else {
      submitRegistration({
        email: form.values.email,
        firstName: form.values.firstName,
        lastName: form.values.lastName,
        phone: form.values.phoneNumber,
        provider: form.values.provider as "email" | "google" | "facebook",
        companyName: form.values.companyName,
        location: form.values.location,
        website: form.values.website,
        twitter: form.values.twitter,
        instagram: form.values.instagram,
        facebook: form.values.facebook,
        youtube: form.values.youtube,
        tiktok: form.values.tiktok,
        vimeo: form.values.vimeo,
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