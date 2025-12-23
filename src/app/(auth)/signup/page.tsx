'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Stack,
  Container,
  TextField,
} from '@mui/material';
import { useAuth } from '@/lib/auth-context';
import { useMuiToast } from '@/hooks/use-mui-toast';
import { MuiPublicLayout, AuthCardHeader, StyledLink } from '@/components/mui';

const signUpSchema = z
  .object({
    name: z.string().optional(),
    email: z.string().email('Please enter a valid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type SignUpFormData = z.infer<typeof signUpSchema>;

export default function MuiSignUpPage() {
  const router = useRouter();
  const { user, loading, signUp } = useAuth();
  const { success, error: showError } = useMuiToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard');
    }
  }, [user, loading, router]);

  if (loading || user) {
    return null;
  }

  const onSubmit = async (data: SignUpFormData) => {
    setIsSubmitting(true);
    try {
      // Only pass name if it has a value
      await signUp(data.email, data.password, data.name || undefined);
      success('Account created successfully!');
      router.refresh();
      router.push('/dashboard');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed';
      showError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <MuiPublicLayout>
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Box display="flex" justifyContent="center">
          <Card sx={{ width: '100%', maxWidth: 400 }}>
            <CardContent sx={{ p: 4 }}>
              <AuthCardHeader
                title="Create Account"
                description="Enter your information to create a new account"
              />

              <Box component="form" onSubmit={handleSubmit(onSubmit)}>
                <Stack spacing={3}>
                  <Controller
                    name="name"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Name (optional)"
                        placeholder="John Doe"
                        fullWidth
                        disabled={isSubmitting}
                      />
                    )}
                  />
                  <Controller
                    name="email"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Email"
                        type="email"
                        placeholder="name@example.com"
                        fullWidth
                        disabled={isSubmitting}
                        error={!!errors.email}
                        helperText={errors.email?.message}
                      />
                    )}
                  />
                  <Controller
                    name="password"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Password"
                        type="password"
                        fullWidth
                        disabled={isSubmitting}
                        error={!!errors.password}
                        helperText={errors.password?.message}
                      />
                    )}
                  />
                  <Controller
                    name="confirmPassword"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Confirm Password"
                        type="password"
                        fullWidth
                        disabled={isSubmitting}
                        error={!!errors.confirmPassword}
                        helperText={errors.confirmPassword?.message}
                      />
                    )}
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    fullWidth
                    size="large"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Creating account...' : 'Sign Up'}
                  </Button>
                </Stack>
              </Box>

              <Typography variant="body2" sx={{ mt: 3 }}>
                Already have an account?{' '}
                <StyledLink href="/signin">
                  Sign in
                </StyledLink>
              </Typography>
            </CardContent>
          </Card>
        </Box>
      </Container>
    </MuiPublicLayout>
  );
}
