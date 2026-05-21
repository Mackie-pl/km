import { Component, OnDestroy } from '@angular/core';
import { Editor as TipTapEditor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TiptapEditorDirective } from 'ngx-tiptap';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-editor',
  templateUrl: './editor.html',
  imports: [TiptapEditorDirective, FormsModule],
})
export class Editor implements OnDestroy {
  editor = new TipTapEditor({
    extensions: [StarterKit],
  });

  value = '<p>Hello, Tiptap!</p>'; // can be HTML or JSON, see https://www.tiptap.dev/api/editor#content

  ngOnDestroy(): void {
    this.editor.destroy();
  }
}
