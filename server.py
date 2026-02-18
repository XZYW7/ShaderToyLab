import http.server
import socketserver
import os
import json

PORT = 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_POST(self):
        if self.path == '/save':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                filename = data.get('filename')
                code = data.get('code')
                
                if not filename or not code:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b'Missing filename or code')
                    return

                # Ensure filename is safe and ends with .frag
                filename = os.path.basename(filename)
                if not filename.endswith('.frag'):
                    filename += '.frag'
                
                filepath = os.path.join(os.getcwd(), 'shaders', filename)
                
                # Make sure shaders dir exists
                os.makedirs(os.path.join(os.getcwd(), 'shaders'), exist_ok=True)

                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(code)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'ok', 'message': f'Saved to shaders/{filename}'}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(current_dir)
    
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving ShaderToyLab at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
