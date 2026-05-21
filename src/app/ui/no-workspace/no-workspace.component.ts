import { Component, output } from '@angular/core';

/**
 * Full-screen overlay shown when no workspace is selected.
 * Purely presentational — emits an event when the user clicks "Pick Workspace".
 */
@Component({
  selector: 'app-no-workspace',
  standalone: true,
  templateUrl: './no-workspace.component.html',
  styleUrl: './no-workspace.component.scss',
})
export class NoWorkspaceComponent {
  /** Emitted when the user clicks the "Pick Workspace" button */
  readonly pickWorkspace = output();
}
