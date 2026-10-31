import { Button, Center, Group, Stack, Text, Title } from '@mantine/core';
import { IconPlugConnectedX, IconRefresh } from '@tabler/icons-react';

interface Props {
  message: string | null;
}

export function BootError({ message }: Props) {
  return (
    <Center h="100vh" style={{ background: 'var(--ds-bg)' }}>
      <Stack align="center" gap="sm" maw={460}>
        <IconPlugConnectedX size={44} stroke={1.8} color="var(--ds-text-faint)" />
        <Title order={3} className="ds-display">没有连上后端</Title>
        <Text fz="var(--ds-fs-body)" c="var(--ds-text-dim)" ta="center">
          {message ?? '原生桥接没有就绪，可能是开发服务器刚启动或后端进程已退出。'}
        </Text>
        <Group mt="xs">
          <Button
            leftSection={<IconRefresh size={18} />}
            onClick={() => window.location.reload()}
          >
            重新加载
          </Button>
        </Group>
        <Text size="xs" c="var(--ds-text-faint)" ta="center">
          如果是浏览器里调试，加 <code>?mock</code> 使用示例数据。
        </Text>
      </Stack>
    </Center>
  );
}
