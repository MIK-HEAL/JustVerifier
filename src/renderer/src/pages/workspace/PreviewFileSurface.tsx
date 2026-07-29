import { Maximize2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PreviewFileItem } from '@/stores/preview-workbench-store'

import { ExtensionPreservingFileName } from './ExtensionPreservingFileName'
import { ManagedFileDownloadButton } from './ManagedFileDownloadButton'
import { PreviewFileContent } from './previews/PreviewFileContent'

type PreviewFileSurfaceProps = {
  item: PreviewFileItem
  contentKey?: string
  renderContent?: boolean
  tooltipClassName?: string
  onClose: () => void
  onOpenFullScreen?: () => void
}

// The optional callback makes the maximize action available only in the compact workbench panel;
// the dialog reuses this header without exposing a nested full-screen action.
const PreviewFileHeader = ({
  item,
  onClose,
  onOpenFullScreen,
  tooltipClassName
}: Pick<
  PreviewFileSurfaceProps,
  'item' | 'onClose' | 'onOpenFullScreen' | 'tooltipClassName'
>): React.JSX.Element => (
  <header
    data-testid="preview-card-header"
    className="flex h-8 shrink-0 items-center gap-1 border-b border-border-300/50 px-2"
  >
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="min-w-0 flex-1 text-[12px] font-medium text-text-000">
            <ExtensionPreservingFileName name={item.name} className="flex-1" />
          </span>
        </TooltipTrigger>
        <TooltipContent className={tooltipClassName}>{item.title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <ManagedFileDownloadButton
      source={item.source ?? 'artifact'}
      path={item.path}
      suggestedName={item.name}
      className="bg-transparent shadow-none"
    />
    {onOpenFullScreen ? (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-text-100 hover:text-text-000"
              aria-label={`Open full screen preview of ${item.title}`}
              onClick={onOpenFullScreen}
            >
              <Maximize2 aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className={tooltipClassName}>Open full screen preview</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : null}
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-text-100 hover:text-text-000"
            aria-label={`Close preview of ${item.title}`}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent className={tooltipClassName}>Close preview</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </header>
)

// The content slot is shared by both presentations so every supported file type follows the same
// renderer path. Callers can temporarily suppress it while another surface owns the preview.
const PreviewFileSurface = ({
  item,
  contentKey,
  renderContent = true,
  tooltipClassName,
  onClose,
  onOpenFullScreen
}: PreviewFileSurfaceProps): React.JSX.Element => (
  <div className="flex size-full min-h-0 flex-col overflow-hidden">
    <PreviewFileHeader
      item={item}
      onClose={onClose}
      onOpenFullScreen={onOpenFullScreen}
      tooltipClassName={tooltipClassName}
    />
    <div className="min-h-0 flex-1 overflow-y-auto bg-bg-000">
      {renderContent ? <PreviewFileContent key={contentKey} item={item} /> : null}
    </div>
  </div>
)

export { PreviewFileSurface }
