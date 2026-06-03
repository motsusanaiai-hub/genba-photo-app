import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { ProjectFormData } from '@/types/project'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'

const projectSchema = z
  .object({
    name: z
      .string()
      .min(1, '工事名を入力してください')
      .max(100, '100文字以内で入力してください'),
    location: z.string().max(200, '200文字以内で入力してください').default(''),
    start_date: z.string().default(''),
    end_date: z.string().default(''),
  })
  .refine(
    (data) => {
      if (!data.start_date || !data.end_date) return true
      return data.start_date <= data.end_date
    },
    { message: '終了日は開始日以降にしてください', path: ['end_date'] },
  )

type ProjectFormValues = z.infer<typeof projectSchema>

interface Props {
  defaultValues?: Partial<ProjectFormData>
  onSubmit: (data: ProjectFormData) => void | Promise<void>
  submitLabel: string
  isLoading?: boolean
}

export function ProjectForm({ defaultValues, onSubmit, submitLabel, isLoading }: Props) {
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: defaultValues?.name ?? '',
      location: defaultValues?.location ?? '',
      start_date: defaultValues?.start_date ?? '',
      end_date: defaultValues?.end_date ?? '',
    },
  })

  const handleSubmit = async (values: ProjectFormValues) => {
    await onSubmit({
      name: values.name,
      location: values.location,
      start_date: values.start_date,
      end_date: values.end_date,
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                工事名 <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="◯◯補修工事" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <FormLabel>現場住所</FormLabel>
              <FormControl>
                <Input placeholder="東京都新宿区◯◯..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="start_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>工事開始日</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="end_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>工事終了日</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? '保存中...' : submitLabel}
        </Button>
      </form>
    </Form>
  )
}
