import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';

import { useAppStore } from '../lib/store/useAppStore';

/**
 * 头像上传命名弹窗（全局单例，挂 AppShell）：
 * 世界卡右键与图片库共用；默认名为图片文件名，可改。
 */
export function AvatarUploadModal() {
  const pending = useAppStore((state) => state.uploadPending);
  const setPendingName = useAppStore((state) => state.setUploadPendingName);
  const confirm = useAppStore((state) => state.confirmAvatarUpload);
  const cancel = useAppStore((state) => state.cancelAvatarUpload);

  return (
    <Modal
      opened={pending !== null}
      onClose={cancel}
      title={`为「${pending?.char ?? ''}」更新存档头像`}
      size={380}
      centered
      styles={{ content: { background: 'var(--ds-surface)' } }}
    >
      <Stack gap="sm">
        <Text fz="var(--ds-fs-micro)" c="var(--ds-text-faint)">
          已选择 {pending?.sourcePath ? pending.sourcePath.split('\\').pop() : ''}。
          名字仅用于图片库标注，内置角色的中文名不受影响：
        </Text>
        <TextInput
          data-autofocus
          label="显示名称"
          placeholder="默认使用图片文件名"
          value={pending?.defaultName ?? ''}
          onChange={(event) => setPendingName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void confirm();
          }}
        />
        <Group justify="flex-end">
          <Button variant="default" size="sm" onClick={cancel}>取消</Button>
          <Button size="sm" onClick={() => void confirm()}>确认上传</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
