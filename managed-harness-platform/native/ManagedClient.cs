using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web;
using System.Web.Script.Serialization;
using System.Windows.Forms;

sealed class ManagedClient : Form {
    readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=8*1024*1024};
    readonly HttpClient remote=new HttpClient(new HttpClientHandler{UseProxy=false,AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(5)};
    HttpClient local;
    EngineJob engine;
    string origin,token,userID,sessionID,workspace,localOrigin;
    int revision=-1,workEpoch,authEpoch;
    bool polling,online,starting,submitting,authenticating;
    TcpListener signInListener;
    readonly Label status=new Label{AutoSize=true,Text="Sign in to load your approved models and connectors."};
    readonly ComboBox models=new ComboBox{DropDownStyle=ComboBoxStyle.DropDownList,Width=250};
    readonly RichTextBox transcript=new RichTextBox{Dock=DockStyle.Fill,ReadOnly=true,BackColor=Color.White,BorderStyle=BorderStyle.None,Font=new Font("Segoe UI",11),DetectUrls=false};
    readonly TextBox prompt=new TextBox{Multiline=true,Dock=DockStyle.Fill,Font=new Font("Segoe UI",11),AcceptsReturn=true,ScrollBars=ScrollBars.Vertical};
    readonly Button send=new Button{Text="Send",Width=90,Dock=DockStyle.Right,Enabled=false};
    readonly Button signIn=new Button{Text="Sign in",AutoSize=true};
    readonly Button emailSignIn=new Button{Text="Email code",AutoSize=true};
    readonly Button folder=new Button{Text="Choose folder",AutoSize=true};
    readonly Button key=new Button{Text="Personal API key",AutoSize=true,Enabled=false};
    readonly Button stop=new Button{Text="Stop",AutoSize=true,Enabled=false};
    readonly Button newSession=new Button{Text="New session",AutoSize=true,Enabled=false};
    readonly Button accounts=new Button{Text="Connector accounts",AutoSize=true,Enabled=false};
    readonly Button signOut=new Button{Text="Sign out",AutoSize=true,Enabled=false};
    readonly Label folderLabel=new Label{AutoSize=true,Text="No folder selected"};
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer{Interval=1000};
    [STAThread] static int Main(){ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);try{Application.Run(new ManagedClient());return 0;}catch(Exception e){MessageBox.Show("Unable to start the managed client. Check the installation and server address.\n"+e.GetType().Name,"Managed OpenCode");return 1;}}
    ManagedClient(){
        Text="Managed OpenCode";MinimumSize=new Size(780,600);Size=new Size(1080,800);StartPosition=FormStartPosition.CenterScreen;Font=new Font("Segoe UI",10);BackColor=Color.FromArgb(247,247,244);
        var settings=Map(json.DeserializeObject(File.ReadAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ManagedOpenCodeCentral","Client","client.json"))));
        origin=NetworkAddress.Origin(TextOf(settings,"serverOrigin"));
        var layout=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(20),ColumnCount=1,RowCount=7};layout.RowStyles.Add(new RowStyle(SizeType.Absolute,45));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,45));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,42));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,35));layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,125));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,30));
        var title=new FlowLayoutPanel{Dock=DockStyle.Fill};title.Controls.Add(new Label{Text="Managed OpenCode",AutoSize=true,Font=new Font("Segoe UI",18,FontStyle.Bold)});title.Controls.Add(new Label{Text=origin,AutoSize=true,Padding=new Padding(15,10,0,0)});
        var tools=new FlowLayoutPanel{Dock=DockStyle.Fill};tools.Controls.AddRange(new Control[]{signIn,emailSignIn,models,folder,key,signOut});
        var composer=new Panel{Dock=DockStyle.Fill,Padding=new Padding(0,15,0,10)};composer.Controls.Add(prompt);composer.Controls.Add(send);
        layout.Controls.Add(title,0,0);layout.Controls.Add(tools,0,1);var actions=new FlowLayoutPanel{Dock=DockStyle.Fill};actions.Controls.AddRange(new Control[]{newSession,stop,accounts});layout.Controls.Add(actions,0,2);layout.Controls.Add(folderLabel,0,3);layout.Controls.Add(transcript,0,4);layout.Controls.Add(composer,0,5);layout.Controls.Add(status,0,6);Controls.Add(layout);
        signIn.Click+=async delegate{await Run(Login);};folder.Click+=delegate{using(var dialog=new FolderBrowserDialog()){if(dialog.ShowDialog()==DialogResult.OK){StopEngine();sessionID=null;workspace=dialog.SelectedPath;folderLabel.Text=workspace;}}};
        key.Click+=async delegate{await Run(EnrollKey);};send.Click+=async delegate{await Run(SendPrompt);};signOut.Click+=async delegate{await Run(Logout);};
        emailSignIn.Click+=async delegate{await Run(EmailLogin);};
        models.SelectedIndexChanged+=delegate{StopEngine();sessionID=null;transcript.Clear();};
        newSession.Click+=delegate{StopEngine();sessionID=null;transcript.Clear();status.Text="New session. Choose a folder and enter a prompt.";};
        stop.Click+=delegate{StopEngine();status.Text="Managed work stopped.";};
        accounts.Click+=delegate{Process.Start(new ProcessStartInfo(origin+"/"){UseShellExecute=true});};
        Shown+=async delegate{await Run(LoadMethods);};
        timer.Tick+=async delegate{if(polling||token==null||starting||authenticating)return;polling=true;int attempt=authEpoch;try{await RefreshState();}catch{if(attempt==authEpoch)SetOffline("Server unavailable. Managed work has stopped; reconnecting.");}finally{polling=false;}};timer.Start();
        FormClosed+=delegate{timer.Stop();InvalidateAuthentication();StopEngine();remote.Dispose();};
    }
    async Task LoadMethods(){var methods=Map(await Api("/auth/methods","GET",null,true));signIn.Visible=Convert.ToBoolean(methods["saml"]);emailSignIn.Visible=Convert.ToBoolean(methods["emailOtp"]);if(!signIn.Visible&&!emailSignIn.Visible)status.Text="The administrator has not configured sign-in yet.";}
    async Task Run(Func<Task> action){try{await action();}catch(TaskCanceledException){status.Text="Request timed out. Check server connectivity and retry.";}catch(OperationCanceledException){}catch(Exception e){status.Text=e is HttpRequestException?"Request failed. Check sign-in, policy and server connectivity.":e.Message;}}
    async Task<object> Api(string route,string method="GET",object body=null,bool anonymous=false){
        string requestedToken=token;int attempt=authEpoch;
        using(var request=new HttpRequestMessage(new HttpMethod(method),origin+route)){
            if(!anonymous){if(token==null)throw new InvalidOperationException("Sign in first.");request.Headers.Authorization=new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer",token);}
            if(body!=null)request.Content=new StringContent(json.Serialize(body),Encoding.UTF8,"application/json");
            using(var response=await remote.SendAsync(request)){if(response.StatusCode==HttpStatusCode.Unauthorized&&!anonymous&&token==requestedToken&&authEpoch==attempt){InvalidateAuthentication();token=null;SetOffline("Session expired. Sign in again.");signIn.Enabled=emailSignIn.Enabled=true;}response.EnsureSuccessStatusCode();return json.DeserializeObject(await response.Content.ReadAsStringAsync());}
        }
    }
    async Task Login(){
        int attempt=BeginAuthentication();if(attempt==0)return;status.Text="Complete sign-in in your browser.";
        var listener=new TcpListener(IPAddress.Loopback,0);
        try{
            listener.Start();signInListener=listener;
            int port=((IPEndPoint)listener.LocalEndpoint).Port;string verifier=RandomToken(),state=RandomToken(),challenge;
            using(var sha=SHA256.Create())challenge=Base64Url(sha.ComputeHash(Encoding.ASCII.GetBytes(verifier)));
            var start=Map(await Api("/auth/desktop/start","POST",new{challenge,port,state},true));EnsureAuthentication(attempt);var url=new Uri(TextOf(start,"url"));if(url.GetLeftPart(UriPartial.Authority)!=origin||url.Scheme!="https")throw new InvalidOperationException("Invalid sign-in redirect");
            Process.Start(new ProcessStartInfo(url.AbsoluteUri){UseShellExecute=true});
            var accept=listener.AcceptTcpClientAsync();if(await Task.WhenAny(accept,Task.Delay(TimeSpan.FromMinutes(5)))!=accept)throw new TimeoutException("Sign-in timed out. Try again.");
            string code;
            using(var connection=await accept){connection.ReceiveTimeout=5000;using(var stream=connection.GetStream()){
                var bytes=new List<byte>();var one=new byte[1];while(bytes.Count<8192){var read=stream.ReadAsync(one,0,1);if(await Task.WhenAny(read,Task.Delay(5000))!=read)throw new TimeoutException("Sign-in callback timed out");if(await read==0)break;bytes.Add(one[0]);if(bytes.Count>=4&&bytes[bytes.Count-4]==13&&bytes[bytes.Count-3]==10&&bytes[bytes.Count-2]==13&&bytes[bytes.Count-1]==10)break;}
                string first=Encoding.ASCII.GetString(bytes.ToArray()).Split('\r')[0];if(!first.StartsWith("GET /authorized?",StringComparison.Ordinal))throw new InvalidOperationException("Invalid sign-in callback");
                var callback=new Uri("http://127.0.0.1:"+port+first.Split(' ')[1]);var query=HttpUtility.ParseQueryString(callback.Query);if(query["state"]!=state)throw new InvalidOperationException("Sign-in state did not match");code=query["code"];
                byte[] reply=Encoding.UTF8.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\n\r\nSign-in received. You can return to Managed OpenCode.");await stream.WriteAsync(reply,0,reply.Length);
            }}
            EnsureAuthentication(attempt);var exchange=Map(await Api("/auth/desktop/exchange","POST",new{code,verifier},true));await CompleteAuthentication(attempt,TextOf(exchange,"token"));
        }catch{if(attempt!=authEpoch)throw new OperationCanceledException();throw;}finally{listener.Stop();if(ReferenceEquals(signInListener,listener))signInListener=null;EndAuthentication(attempt);}
    }
    async Task EmailLogin(){
        int attempt=BeginAuthentication();if(attempt==0)return;
        try{
            string email=AskText("Email sign-in","Enter your administrator-approved email address.",false);if(email==null)return;EnsureAuthentication(attempt);
            string verifier=RandomToken(),challenge;using(var sha=SHA256.Create())challenge=Base64Url(sha.ComputeHash(Encoding.ASCII.GetBytes(verifier)));
            var started=Map(await Api("/auth/email/start","POST",new{email,kind="desktop",challenge},true));EnsureAuthentication(attempt);
            string code=AskText("Check your email","Enter the 8-digit code. It expires in 5 minutes.",false);if(code==null)return;
            var exchange=Map(await Api("/auth/email/verify","POST",new{requestId=TextOf(started,"requestId"),code=code.Trim(),verifier},true));
            await CompleteAuthentication(attempt,TextOf(exchange,"token"));
        }catch{if(attempt!=authEpoch)throw new OperationCanceledException();throw;}finally{EndAuthentication(attempt);}
    }
    int BeginAuthentication(){if(authenticating||token!=null)return 0;authenticating=true;int attempt=++authEpoch;signIn.Enabled=emailSignIn.Enabled=false;signOut.Enabled=true;signOut.Text="Cancel sign-in";return attempt;}
    void EnsureAuthentication(int attempt){if(attempt!=authEpoch||!authenticating||IsDisposed)throw new OperationCanceledException();}
    void EndAuthentication(int attempt){if(attempt!=authEpoch)return;authenticating=false;signIn.Enabled=emailSignIn.Enabled=token==null;signOut.Text="Sign out";signOut.Enabled=token!=null;}
    void InvalidateAuthentication(){authEpoch++;authenticating=false;if(signInListener!=null){signInListener.Stop();signInListener=null;}signOut.Text="Sign out";}
    async Task CompleteAuthentication(int attempt,string candidate){
        EnsureAuthentication(attempt);IDictionary<string,object> me;
        using(var request=new HttpRequestMessage(HttpMethod.Get,origin+"/api/me")){request.Headers.Authorization=new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer",candidate);using(var response=await remote.SendAsync(request)){response.EnsureSuccessStatusCode();me=Map(json.DeserializeObject(await response.Content.ReadAsStringAsync()));}}
        EnsureAuthentication(attempt);StopEngine();sessionID=null;transcript.Clear();models.Items.Clear();token=candidate;userID=TextOf(me,"id");catalogGeneration=null;revision=-1;await RefreshState();EnsureAuthentication(attempt);
    }
    string AskText(string title,string caption,bool secret){using(var form=new Form{Text=title,Size=new Size(520,210),StartPosition=FormStartPosition.CenterParent,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,MinimizeBox=false}){var text=new TextBox{Location=new Point(20,55),Width=460,UseSystemPasswordChar=secret};var ok=new Button{Text="Continue",DialogResult=DialogResult.OK,Location=new Point(390,100)};form.Controls.AddRange(new Control[]{new Label{Text=caption,AutoSize=true,Location=new Point(20,20)},text,ok});form.AcceptButton=ok;return form.ShowDialog(this)==DialogResult.OK?text.Text:null;}}
    async Task Logout(){InvalidateAuthentication();StopEngine();try{if(token!=null)await Api("/api/logout","POST",new{});}finally{token=null;userID=null;sessionID=null;transcript.Clear();models.Items.Clear();online=false;send.Enabled=key.Enabled=signOut.Enabled=accounts.Enabled=newSession.Enabled=stop.Enabled=false;catalogGeneration=null;signIn.Enabled=emailSignIn.Enabled=true;status.Text="Signed out.";}}
    async Task EnrollKey(){
        using(var form=new Form{Text="Your personal API key",Size=new Size(520,210),StartPosition=FormStartPosition.CenterParent,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,MinimizeBox=false}){
            var label=new Label{Text="Stored securely on the management server for your account.",AutoSize=true,Location=new Point(20,20)};var secret=new TextBox{UseSystemPasswordChar=true,Width=460,Location=new Point(20,55)};var save=new Button{Text="Save key",DialogResult=DialogResult.OK,Location=new Point(390,100)};form.Controls.AddRange(new Control[]{label,secret,save});form.AcceptButton=save;if(form.ShowDialog(this)==DialogResult.OK){string value=secret.Text;secret.Clear();await Api("/api/key","PUT",new{key=value});status.Text="Personal key saved.";}
        }
    }
    async Task RefreshState(){
        int attempt=authEpoch;string identity=token;var catalog=Map(await Api("/api/catalog"));if(attempt!=authEpoch||identity!=token)return;int next=Convert.ToInt32(catalog["revision"]);
        // The server catalog contains a generation for connector changes as well as policy revisions.
        string generation=json.Serialize(catalog);
        if(generation!=catalogGeneration){StopEngine();sessionID=null;catalogGeneration=generation;revision=next;string selected=models.SelectedItem is ModelItem?((ModelItem)models.SelectedItem).Id:null;models.Items.Clear();foreach(var value in Items(catalog["models"])){var item=Map(value);models.Items.Add(new ModelItem{Id=TextOf(item,"id"),Name=TextOf(item,"name")});}if(models.Items.Count>0)models.SelectedIndex=0;for(int i=0;i<models.Items.Count;i++)if(((ModelItem)models.Items[i]).Id==selected)models.SelectedIndex=i;status.Text="Connected. Current policy loaded.";}
        online=true;send.Enabled=models.Items.Count>0&&!submitting;key.Enabled=signOut.Enabled=accounts.Enabled=newSession.Enabled=true;stop.Enabled=engine!=null;signIn.Enabled=emailSignIn.Enabled=false;transcript.Visible=true;
        var pending=Items(await Api("/api/actions/pending"));if(attempt!=authEpoch||identity!=token)return;foreach(var value in pending){if(attempt!=authEpoch||identity!=token)return;var item=Map(value);var decision=MessageBox.Show(this,TextOf(item,"preview"),"Approve "+TextOf(item,"capability")+"?",MessageBoxButtons.YesNo,MessageBoxIcon.Question,MessageBoxDefaultButton.Button2);if(attempt!=authEpoch||identity!=token)return;await Api("/api/actions/"+TextOf(item,"id")+"/decision","POST",new{approve=decision==DialogResult.Yes});}
        if(engine!=null&&sessionID!=null){if(!engine.Running)throw new InvalidOperationException("Engine stopped");await RefreshMessages();}
    }
    async Task RefreshMessages(){int epoch=workEpoch;var messages=Map(await Local("/api/session/"+sessionID+"/message?limit=200&order=desc"));if(epoch==workEpoch)RenderMessages(Items(messages["data"]).Reverse().ToArray());}
    void RenderMessages(object messages){
        var text=new StringBuilder();string activity="";
        if(Items(messages).Count()==200)text.Append("Showing the latest 200 messages.\n\n");
        foreach(var value in Items(messages)){
            var item=Map(value);string kind=TextOf(item,"type");
            if(kind=="user"){text.Append("You\n").Append(TextOf(item,"text")).Append("\n\n");activity="OpenCode is working.";}
            if(kind=="assistant"){
                text.Append("OpenCode\n");
                foreach(var partValue in Items(item["content"])){
                    var part=Map(partValue);if(TextOf(part,"type")=="text")text.Append(TextOf(part,"text"));
                    if(TextOf(part,"type")=="tool"){
                        var state=Map(part["state"]);text.Append("\n[").Append(TextOf(part,"name")).Append(": ").Append(TextOf(state,"status")).Append("]\n");
                        if(TextOf(state,"status")=="error"&&state.ContainsKey("error"))text.Append(TextOf(Map(state["error"]),"message")).Append("\n");
                    }
                }
                if(item.ContainsKey("error"))text.Append("\n").Append(TextOf(Map(item["error"]),"message"));
                text.Append("\n\n");
            }
            if(kind=="idle"){
                activity=TextOf(item,"outcome")=="succeeded"?"Ready.":TextOf(item,"outcome")=="interrupted"?"Work interrupted.":"Work ended with an error.";
                if(item.ContainsKey("error"))text.Append(TextOf(Map(item["error"]),"message")).Append("\n\n");
            }
        }
        string rendered=text.ToString();if(transcript.Text!=rendered){transcript.Text=rendered;transcript.SelectionStart=transcript.TextLength;transcript.ScrollToCaret();}
        if(activity.Length>0)status.Text=activity;
    }
    string catalogGeneration;
    void SetOffline(string message){online=false;send.Enabled=key.Enabled=accounts.Enabled=newSession.Enabled=stop.Enabled=false;transcript.Visible=false;StopEngine();status.Text=message;}
    void StopEngine(){workEpoch++;DisposeEngine();}
    void DisposeEngine(){stop.Enabled=false;if(engine!=null){engine.Dispose();engine=null;}if(local!=null){local.Dispose();local=null;}localOrigin=null;}
    async Task EnsureEngine(int epoch){
        if(engine!=null&&engine.Running)return;if(!online||token==null)throw new InvalidOperationException("A live management connection is required.");if(workspace==null)throw new InvalidOperationException("Choose a working folder first.");
        starting=true;stop.Enabled=true;try{
            var access=Map(await Api("/api/engine","POST",new{}));if(epoch!=workEpoch)throw new OperationCanceledException();string secret=RandomToken();
            var env=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);foreach(DictionaryEntry entry in Environment.GetEnvironmentVariables()){string name=(string)entry.Key;if(name.StartsWith("OPENCODE_",StringComparison.OrdinalIgnoreCase)||name.StartsWith("MANAGED_OPENCODE_",StringComparison.OrdinalIgnoreCase)||name.StartsWith("BUN_",StringComparison.OrdinalIgnoreCase)||name=="NODE_OPTIONS"||name=="NODE_TLS_REJECT_UNAUTHORIZED"||name=="NODE_EXTRA_CA_CERTS")continue;env[name]=(string)entry.Value;}
            string profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ManagedOpenCode",userID);Directory.CreateDirectory(profile);env["XDG_DATA_HOME"]=Path.Combine(profile,"data");env["XDG_CONFIG_HOME"]=Path.Combine(profile,"config");env["XDG_CACHE_HOME"]=Path.Combine(profile,"cache");env["XDG_STATE_HOME"]=Path.Combine(profile,"state");env["MANAGED_OPENCODE_SESSION"]=TextOf(access,"token");env["OPENCODE_SERVER_PASSWORD"]=secret;
            string executable=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"ManagedOpenCodeCentral","Client","opencode-engine.exe");engine=new EngineJob(executable,"serve --hostname 127.0.0.1 --port 0",workspace,env);
            localOrigin=await engine.ListeningOrigin();if(epoch!=workEpoch)throw new OperationCanceledException();stop.Enabled=true;local=new HttpClient(new HttpClientHandler{UseProxy=false,AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(10)};local.DefaultRequestHeaders.Authorization=new System.Net.Http.Headers.AuthenticationHeaderValue("Basic",Convert.ToBase64String(Encoding.UTF8.GetBytes("opencode:"+secret)));
            DateTime deadline=DateTime.UtcNow.AddSeconds(45);while(true){if(epoch!=workEpoch)throw new OperationCanceledException();if(!engine.Running)throw new InvalidOperationException("OpenCode could not start. Check the protected client configuration.");try{await Local("/api/session?limit=1");break;}catch{if(epoch!=workEpoch)throw new OperationCanceledException();if(DateTime.UtcNow>=deadline)throw new TimeoutException("OpenCode startup timed out");}await Task.Delay(250);}
        }catch{if(epoch==workEpoch)DisposeEngine();throw;}finally{starting=false;}
    }
    async Task<object> Local(string route,string method="GET",object body=null){using(var request=new HttpRequestMessage(new HttpMethod(method),localOrigin+route)){if(body!=null)request.Content=new StringContent(json.Serialize(body),Encoding.UTF8,"application/json");using(var response=await local.SendAsync(request)){response.EnsureSuccessStatusCode();string value=await response.Content.ReadAsStringAsync();return value.Length==0?null:json.DeserializeObject(value);}}}
    async Task SendPrompt(){if(submitting||string.IsNullOrWhiteSpace(prompt.Text))return;submitting=true;int epoch=workEpoch;send.Enabled=false;folder.Enabled=models.Enabled=false;try{await RefreshState();if(epoch!=workEpoch)throw new OperationCanceledException();await EnsureEngine(epoch);if(epoch!=workEpoch)throw new OperationCanceledException();if(sessionID==null){var model=(ModelItem)models.SelectedItem;var created=Map(await Local("/api/session","POST",new{title="Managed coding session",model=new{providerID="managed",id=model.Id},location=new{directory=workspace}}));if(epoch!=workEpoch)throw new OperationCanceledException();sessionID=TextOf(Map(created["data"]),"id");}if(epoch!=workEpoch)throw new OperationCanceledException();await Local("/api/session/"+sessionID+"/prompt","POST",new{text=prompt.Text});if(epoch!=workEpoch)throw new OperationCanceledException();prompt.Clear();status.Text="OpenCode is working.";}catch{if(epoch!=workEpoch)throw new OperationCanceledException();throw;}finally{submitting=false;send.Enabled=online&&models.Items.Count>0;folder.Enabled=models.Enabled=true;}}
    static IDictionary<string,object> Map(object value){return (IDictionary<string,object>)value;}
    static IEnumerable<object> Items(object value){return (IEnumerable<object>)value;}
    static string TextOf(IDictionary<string,object> value,string key){object result;return value.TryGetValue(key,out result)&&result!=null?Convert.ToString(result):"";}
    static string Base64Url(byte[] bytes){return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+','-').Replace('/','_');}
    static string RandomToken(){var bytes=new byte[32];using(var rng=RandomNumberGenerator.Create())rng.GetBytes(bytes);return Base64Url(bytes);}
    sealed class ModelItem{public string Id,Name;public override string ToString(){return Name;}}
}
