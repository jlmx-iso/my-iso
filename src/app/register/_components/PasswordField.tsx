import { Box, PasswordInput, type PasswordInputProps, Popover, Progress, Text, rem } from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';
import { useState } from 'react';

function PasswordRequirement({ meets, label }: { meets: boolean; label: string }) {
  return (
    <Text
      c={meets ? 'teal' : 'red'}
      style={{ alignItems: 'center', display: 'flex' }}
      mt={7}
      size="sm"
    >
      {meets ? (
        <IconCheck style={{ height: rem(14), width: rem(14) }} />
      ) : (
        <IconX style={{ height: rem(14), width: rem(14) }} />
      )}{' '}
      <Box ml={10}>{label}</Box>
    </Text>
  );
}

const requirements = [
  { label: 'Includes number', re: /[0-9]/ },
  { label: 'Includes lowercase letter', re: /[a-z]/ },
  { label: 'Includes uppercase letter', re: /[A-Z]/ },
  { label: 'Includes special symbol', re: /[$&+,:;=?@#|'<>.^*()%!-]/ },
];

function getStrength(password: string) {
  let multiplier = password.length > 5 ? 0 : 1;

  requirements.forEach((requirement) => {
    if (!requirement.re.test(password)) {
      multiplier += 1;
    }
  });

  return Math.max(100 - (100 / (requirements.length + 1)) * multiplier, 10);
}

function PasswordField(props: PasswordInputProps) {
  const [popoverOpened, setPopoverOpened] = useState(false);
  const [value, setValue] = useState('');
  const checks = requirements.map((requirement, index) => (
    <PasswordRequirement key={index} label={requirement.label} meets={requirement.re.test(value)} />
  ));

  const strength = getStrength(value);
  const color = strength === 100 ? 'teal' : strength > 50 ? 'yellow' : 'red';

  return (
    <Popover opened={popoverOpened} position="bottom" width="target" transitionProps={{ transition: 'pop' }}>
      <Popover.Target>
        <div
          onFocusCapture={() => setPopoverOpened(true)}
          onBlurCapture={() => setPopoverOpened(false)}
        >
          <PasswordInput
            {...props}
            onChange={(event) => {
              setValue(event.currentTarget.value);
              }
            }
          />
        </div>
      </Popover.Target>
      <Popover.Dropdown>
        <Progress color={color} value={strength} size={5} mb="xs" />
        <PasswordRequirement label="Includes at least 6 characters" meets={value.length > 5} />
        {checks}
      </Popover.Dropdown>
    </Popover>
  );
}

export default PasswordField;