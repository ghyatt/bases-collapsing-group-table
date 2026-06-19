import { Plugin } from 'obsidian'
import { GroupTableView, VIEW_TYPE } from './bases-view'

export default class CollapsingGroupTablePlugin extends Plugin {
  async onload() {
    this.registerBasesView(VIEW_TYPE, {
      name: 'Collapsing group table',
      icon: 'lucide-list-tree',
      factory: (controller, containerEl) => new GroupTableView(controller, containerEl),
      options: () => {
        return [
          {
            type: 'dropdown',
            displayName: 'Row height',
            key: 'rowHeight',
            default: 'short',
            options: {
              short: 'Short (1 line)',
              medium: 'Medium (3 lines)',
              tall: 'Tall (6 lines)',
              extra: 'Extra tall (12 lines)',
              dynamic: 'Dynamic height',
            },
          },
          {
            type: 'toggle',
            displayName: 'Accordion mode (expand only one group)',
            key: 'accordion',
            default: false,
          },
          {
            type: 'toggle',
            displayName: 'Start with groups collapsed',
            key: 'startCollapsed',
            default: false,
          },
          {
            type: 'toggle',
            displayName: 'Show entry count on group headers',
            key: 'showCount',
            default: true,
          },
          {
            type: 'text',
            displayName: 'Date format (moment tokens, e.g. YYYY-MM-DD)',
            key: 'dateFormat',
            default: '',
            placeholder: 'YYYY-MM-DD',
          },
        ]
      },
    })
  }

  onunload() {}
}
