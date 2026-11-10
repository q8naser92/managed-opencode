using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.ServiceProcess;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

sealed class ManagedSetup : Form {
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=2*1024*1024};
    readonly ComboBox role=new ComboBox{DropDownStyle=ComboBoxStyle.DropDownList,Width=220};
    readonly Dictionary<string,TextBox> fields=new Dictionary<string,TextBox>();
    readonly CheckBox saml=new CheckBox{Text="Configure SAML sign-in",AutoSize=true};
    readonly CheckBox bootstrap=new CheckBox{Text="Configure the initial email administrator",AutoSize=true,Checked=true};
    readonly ComboBox smtpMode=new ComboBox{DropDownStyle=ComboBoxStyle.DropDownList,Width=150};
    readonly Label status=new Label{AutoSize=true,MaximumSize=new Size(730,0),Text="Choose Server or Client, then enter the connection settings."};
    readonly Button install=new Button{Text="Install",AutoSize=true};
    readonly TabControl tabs=new TabControl{Dock=DockStyle.Fill};
    readonly TabPage client=new TabPage("Client"),server=new TabPage("Server"),identity=new TabPage("SAML"),mail=new TabPage("Email sign-in");
    [STAThread] static int Main(string[] args){
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        try{
            if(args.Length>0){string role=null,config=null;bool quiet=false;for(int i=0;i<args.Length;i++){if(args[i]=="--role"&&i+1<args.Length)role=args[++i];else if(args[i]=="--config"&&i+1<args.Length)config=args[++i];else if(args[i]=="--quiet")quiet=true;else throw new ArgumentException("Use --role Client|Server --config path --quiet");}if(role!="Client"&&role!="Server")throw new ArgumentException("Choose Client or Server");if(String.IsNullOrWhiteSpace(config))throw new ArgumentException("A configuration file is required");return Apply(role,Path.GetFullPath(config),quiet);}
            Application.Run(new ManagedSetup());return 0;
        }catch(Exception error){if(Array.IndexOf(args,"--quiet")<0)MessageBox.Show(error.Message,"Managed OpenCode setup",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
    }
    ManagedSetup(){
        Text="Managed OpenCode setup";Size=new Size(820,820);MinimumSize=new Size(740,620);StartPosition=FormStartPosition.CenterScreen;Font=new Font("Segoe UI",10);BackColor=Color.FromArgb(247,247,244);
        var layout=new TableLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(24),ColumnCount=1,RowCount=4};layout.RowStyles.Add(new RowStyle(SizeType.Absolute,70));layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,60));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,45));
        var title=new FlowLayoutPanel{Dock=DockStyle.Fill};title.Controls.Add(new Label{Text="Managed OpenCode",Font=new Font("Segoe UI",20,FontStyle.Bold),AutoSize=true});role.Items.AddRange(new object[]{"Client","Server"});role.SelectedIndex=0;title.Controls.Add(role);
        var cp=Page(client);Add(cp,"clientOrigin","Management server HTTPS address","https://server.example:7443");Add(cp,"clientCa","Additional trusted CA bundle (optional)","",true);cp.Controls.Add(Note("The server address includes your selected port. Users sign in and enter their own key after installation. Public certificates use normal Windows trust; provision internal CA trust through your organization's certificate management."));
        var sp=Page(server);Add(sp,"origin","Public HTTPS address","https://server.example:7443");Add(sp,"port","Listening port","7443");Add(sp,"gateway","Initial LiteLLM HTTPS API base URL","https://gateway.example/v1");Add(sp,"cert","Server certificate chain (PEM)","",true);Add(sp,"key","Server private key (unencrypted PEM)","",true);Add(sp,"serverCa","Additional trusted CA bundle (optional)","",true);sp.Controls.Add(Note("TLS verification stays enabled. Setup protects configuration and private keys, creates a Windows service, and opens only the selected server listening port. Approve models and connectors in the web console after sign-in. On an existing server, change its gateway in the web console; the initial gateway field applies only to a new database."));
        var ip=Page(identity);ip.Controls.Add(saml);Add(ip,"samlEntry","Identity provider SAML sign-in URL");Add(ip,"samlIssuer","Identity provider entity ID / issuer");Add(ip,"samlIdpCert","Identity provider signing certificate (PEM)","",true);Add(ip,"samlEntity","Service provider entity ID");Add(ip,"samlCert","Service provider signing certificate (PEM)","",true);Add(ip,"samlKey","Service provider signing private key (PEM)","",true);Add(ip,"samlAdmins","Administrator persistent subject IDs (one per line)","",false,false,true);ip.Controls.Add(Note("ACS: your public server address + /auth/saml/callback. Metadata: /auth/metadata. Configure persistent NameID, signed responses and signed assertions in your identity provider. Leave SAML off when using email sign-in only."));
        var mp=Page(mail);mp.Controls.Add(bootstrap);Add(mp,"adminEmail","Initial administrator email");Add(mp,"smtpHost","SMTP hostname or IP");Add(mp,"smtpPort","SMTP port","587");mp.Controls.Add(new Label{Text="SMTP TLS mode",AutoSize=true});smtpMode.Items.AddRange(new object[]{"starttls","tls"});smtpMode.SelectedIndex=0;mp.Controls.Add(smtpMode);Add(mp,"smtpName","SMTP certificate DNS name");Add(mp,"smtpUser","SMTP username (optional for approved relay)");Add(mp,"smtpPassword","SMTP password (leave blank to keep it)","",false,true);Add(mp,"smtpFrom","Sender email address");mp.Controls.Add(Note("The local administrator uses an emailed one-time code. Disable this step when upgrading an existing server or when using SAML administrators only."));
        role.SelectedIndexChanged+=delegate{ShowRole();};ShowRole();
        var buttons=new FlowLayoutPanel{Dock=DockStyle.Fill,FlowDirection=FlowDirection.RightToLeft};buttons.Controls.Add(install);var load=new Button{Text="Load configuration file",AutoSize=true};load.Click+=delegate{using(var pick=new OpenFileDialog{Filter="Configuration JSON|*.json"}){if(pick.ShowDialog()==DialogResult.OK){try{LoadConfiguration(pick.FileName);status.Text="Configuration loaded. Review it before installing.";}catch(Exception error){status.Text=error.Message;}}}};buttons.Controls.Add(load);
        install.Click+=async delegate{install.Enabled=role.Enabled=tabs.Enabled=false;try{string selectedRole=(string)role.SelectedItem;var value=Configuration();string temp=SecureWorkspace();try{string path=Path.Combine(temp,"configuration.json");File.WriteAllText(path,Json.Serialize(value),new UTF8Encoding(false));status.Text="Applying installation. This can take a few minutes.";int code=await Task.Run(()=>Apply(selectedRole,path,true));if(code!=0&&code!=3010)throw new InvalidOperationException("Setup failed ("+code+"). Review the protected setup log in ProgramData\\ManagedOpenCodeCentral\\SetupLogs.");status.Text=code==3010?"Installation complete. Restart Windows to finish.":"Installation complete. Open Managed OpenCode or the server web console.";}finally{DeleteWorkspace(temp);}}catch(Exception error){status.Text=error.Message;}finally{install.Enabled=role.Enabled=tabs.Enabled=true;}};
#if CONFIGURE
        Text="Managed OpenCode installation settings";install.Text="Apply settings";bootstrap.Checked=false;
#endif
        layout.Controls.Add(title,0,0);layout.Controls.Add(tabs,0,1);layout.Controls.Add(status,0,2);layout.Controls.Add(buttons,0,3);Controls.Add(layout);
    }
    void ShowRole(){tabs.TabPages.Clear();if((string)role.SelectedItem=="Client")tabs.TabPages.Add(client);else tabs.TabPages.AddRange(new[]{server,identity,mail});}
    static FlowLayoutPanel Page(TabPage page){var p=new FlowLayoutPanel{Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoScroll=true,Padding=new Padding(18)};page.Controls.Add(p);return p;}
    static Label Note(string text){return new Label{Text=text,AutoSize=true,MaximumSize=new Size(650,0),Margin=new Padding(0,18,0,15),ForeColor=Color.DimGray};}
    void Add(FlowLayoutPanel panel,string id,string title,string value="",bool file=false,bool secret=false,bool multiline=false){panel.Controls.Add(new Label{Text=title,AutoSize=true,Margin=new Padding(0,10,0,3)});var row=new FlowLayoutPanel{Width=680,Height=multiline?90:35};var box=new TextBox{Width=file?565:650,Text=value,UseSystemPasswordChar=secret,Multiline=multiline,Height=multiline?80:28};fields[id]=box;row.Controls.Add(box);if(file){var browse=new Button{Text="Browse",AutoSize=true};browse.Click+=delegate{using(var picker=new OpenFileDialog{Filter="PEM certificates and keys|*.pem;*.crt;*.key|All files|*.*"})if(picker.ShowDialog()==DialogResult.OK)box.Text=picker.FileName;};row.Controls.Add(browse);}panel.Controls.Add(row);}
    string Value(string name){return fields[name].Text.Trim();}
    object Configuration(){
        if((string)role.SelectedItem=="Client"){return new{serverOrigin=NetworkAddress.Origin(Value("clientOrigin")),caFile=Value("clientCa")};}
        int port;if(!Int32.TryParse(Value("port"),out port)||port<1||port>65535)throw new ArgumentException("Port must be between 1 and 65535.");
        var data=new Dictionary<string,object>{{"origin",NetworkAddress.Origin(Value("origin"))},{"port",port},{"gatewayUrl",Value("gateway")},{"tlsCert",Value("cert")},{"tlsKey",Value("key")},{"caFile",Value("serverCa")}};
        foreach(string id in new[]{"cert","key"})if(!File.Exists(Value(id)))throw new ArgumentException("Select the server certificate chain and private key.");
        if(saml.Checked)data["saml"]=new{entryPoint=Value("samlEntry"),idpIssuer=Value("samlIssuer"),idpCert=Value("samlIdpCert"),entityId=Value("samlEntity"),signingCert=Value("samlCert"),signingKey=Value("samlKey"),adminSubjects=Value("samlAdmins").Split(new[]{'\r','\n'},StringSplitOptions.RemoveEmptyEntries)};
        if(bootstrap.Checked){int smtpPort;if(!Int32.TryParse(Value("smtpPort"),out smtpPort))throw new ArgumentException("Enter an SMTP port.");data["bootstrap"]=new{adminEmail=Value("adminEmail"),smtp=new{enabled=true,host=Value("smtpHost"),port=smtpPort,mode=(string)smtpMode.SelectedItem,serverName=Value("smtpName"),username=Value("smtpUser"),from=Value("smtpFrom")},smtpPassword=fields["smtpPassword"].Text};}
        return data;
    }
    void LoadConfiguration(string path){var data=(Dictionary<string,object>)Json.DeserializeObject(File.ReadAllText(path));bool isClient=data.ContainsKey("serverOrigin");role.SelectedItem=isClient?"Client":"Server";if(isClient){Put(data,"serverOrigin","clientOrigin");Put(data,"caFile","clientCa");return;}foreach(var pair in new[]{new[]{"origin","origin"},new[]{"port","port"},new[]{"gatewayUrl","gateway"},new[]{"tlsCert","cert"},new[]{"tlsKey","key"},new[]{"caFile","serverCa"}})Put(data,pair[0],pair[1]);saml.Checked=data.ContainsKey("saml");if(saml.Checked){var value=(Dictionary<string,object>)data["saml"];foreach(var pair in new[]{new[]{"entryPoint","samlEntry"},new[]{"idpIssuer","samlIssuer"},new[]{"idpCert","samlIdpCert"},new[]{"entityId","samlEntity"},new[]{"signingCert","samlCert"},new[]{"signingKey","samlKey"}})Put(value,pair[0],pair[1]);fields["samlAdmins"].Text=String.Join(Environment.NewLine,(object[])value["adminSubjects"]);}bootstrap.Checked=data.ContainsKey("bootstrap");if(bootstrap.Checked){var value=(Dictionary<string,object>)data["bootstrap"];Put(value,"adminEmail","adminEmail");Put(value,"smtpPassword","smtpPassword");var smtp=(Dictionary<string,object>)value["smtp"];foreach(var pair in new[]{new[]{"host","smtpHost"},new[]{"port","smtpPort"},new[]{"serverName","smtpName"},new[]{"username","smtpUser"},new[]{"from","smtpFrom"}})Put(smtp,pair[0],pair[1]);smtpMode.SelectedItem=Convert.ToString(smtp["mode"]);}}
    void Put(Dictionary<string,object> source,string key,string target){fields[target].Text=source.ContainsKey(key)?Convert.ToString(source[key]):"";}
    static int Apply(string role,string config,bool quiet){
        if(role!="Client"&&role!="Server")throw new ArgumentException("Invalid role");if(!File.Exists(config))throw new FileNotFoundException("Configuration file not found");
        string temp=SecureWorkspace();try{
#if CONFIGURE
            string helper=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"ManagedOpenCodeCentral","Setup","Configure-Installation.ps1");
            if(role=="Server")using(var service=new ServiceController("ManagedOpenCodeServer")){if(service.Status!=ServiceControllerStatus.Stopped){service.Stop();service.WaitForStatus(ServiceControllerStatus.Stopped,TimeSpan.FromSeconds(30));}}
            string transaction=Guid.NewGuid().ToString("N");int code=Script(helper,role,"Configure",config,transaction);
            try{
                if(code==0&&role=="Server")using(var service=new ServiceController("ManagedOpenCodeServer")){service.Start();service.WaitForStatus(ServiceControllerStatus.Running,TimeSpan.FromSeconds(30));}
                if(code==0)code=Script(helper,role,"Verify",null,transaction);
            }catch{if(code==0)code=1;}
            // Cleanup may have removed some backup files. Never try to restore that partial backup.
            if(code==0){int commit=Script(helper,role,"Commit",null,transaction);if(commit!=0)throw new InvalidOperationException("Configuration applied but transaction cleanup failed. Preserve its backup and contact the administrator.");return 0;}
            int rollback=Script(helper,role,"Rollback",null,transaction);
            if(rollback!=0)throw new InvalidOperationException("Configuration failed and rollback also failed. Preserve the transaction backup for administrator recovery.");
            if(role=="Server")using(var service=new ServiceController("ManagedOpenCodeServer")){service.Refresh();if(service.Status!=ServiceControllerStatus.Running){service.Start();service.WaitForStatus(ServiceControllerStatus.Running,TimeSpan.FromSeconds(30));}}
            return code;

#else
            string extracted=Path.Combine(temp,role+".msi");using(var input=Assembly.GetExecutingAssembly().GetManifestResourceStream(role+".msi")){if(input==null)throw new InvalidOperationException("Installer payload missing");using(var output=new FileStream(extracted,FileMode.CreateNew,FileAccess.Write,FileShare.None))input.CopyTo(output);}
            // Windows Installer needs a persistent source for later repair. Bind each cached payload to its hash.
            string digest=HashFile(extracted);string installation=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ManagedOpenCodeCentral");PrepareInstallationBase(installation);string cache=Path.Combine(installation,"Packages");ProtectDirectory(cache);cache=Path.Combine(cache,digest);ProtectDirectory(cache);string package=Path.Combine(cache,role+".msi");SafePath(package);if(!File.Exists(package))File.Copy(extracted,package,false);ProtectCachedFile(package);if(HashFile(package)!=digest)throw new IOException("The cached installer payload does not match this release.");
            string logs=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ManagedOpenCodeCentral","SetupLogs");ProtectDirectory(logs);string log=Path.Combine(logs,role+"-"+DateTime.UtcNow.ToString("yyyyMMdd-HHmmss")+".log");
            var info=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"msiexec.exe"),"/i "+Quote(package)+" "+(quiet?"/qn":"/passive")+" /norestart CONFIGFILE="+Quote(Path.GetFullPath(config))+" /l*v "+Quote(log)){UseShellExecute=false,CreateNoWindow=true};using(var process=Process.Start(info)){process.WaitForExit();return process.ExitCode;}
#endif
        }finally{DeleteWorkspace(temp);}
    }
#if CONFIGURE
    static int Script(string file,string role,string mode,string config,string transaction){string executable=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe");var args="-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "+Quote(file)+" -Role "+role+" -Mode "+mode+" -TransactionId "+transaction+(config==null?"":" -ConfigFile "+Quote(config));using(var p=Process.Start(new ProcessStartInfo(executable,args){UseShellExecute=false,CreateNoWindow=true})){p.WaitForExit();return p.ExitCode;}}
#endif
    static string Quote(string text){if(text.IndexOf('"')>=0||text.IndexOf('\r')>=0||text.IndexOf('\n')>=0||text.IndexOf('\0')>=0)throw new ArgumentException("Invalid file path");return "\""+text+"\"";}
    static string HashFile(string path){using(var stream=File.OpenRead(path))using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
    static void SafePath(string path){if(File.Exists(path)&&(File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new IOException("A setup file is a reparse point");for(var p=new DirectoryInfo(Path.GetFullPath(path));p!=null;p=p.Parent)if(p.Exists&&(p.Attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("A setup directory is a reparse point");}
    static bool TrustedInstallerPrincipal(string id){return id=="S-1-5-32-544"||id=="S-1-5-18"||id=="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";}
    static void ValidateTrustedAcl(FileSystemSecurity acl){string owner=acl.GetOwner(typeof(SecurityIdentifier)).Value;if(!TrustedInstallerPrincipal(owner))throw new IOException("An existing setup path has an untrusted owner. Ask an administrator to inspect it.");uint safe=(uint)(FileSystemRights.ReadAndExecute|FileSystemRights.Synchronize)|0x80000000u|0x20000000u;foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier)))if(rule.AccessControlType==AccessControlType.Allow&&!TrustedInstallerPrincipal(rule.IdentityReference.Value)&&!(rule.IdentityReference.Value=="S-1-3-0"&&(rule.PropagationFlags&PropagationFlags.InheritOnly)!=0)&&(unchecked((uint)rule.FileSystemRights)&~safe)!=0)throw new IOException("An existing setup path permits untrusted changes. Ask an administrator to inspect it.");}
    static DirectorySecurity DirectoryAcl(bool common){var acl=new DirectorySecurity();acl.SetAccessRuleProtection(true,false);acl.SetOwner(new SecurityIdentifier("S-1-5-32-544"));foreach(string id in new[]{"S-1-5-32-544","S-1-5-18"})acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(id),FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));if(common)acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-5-32-545"),FileSystemRights.ReadAndExecute,InheritanceFlags.None,PropagationFlags.None,AccessControlType.Allow));return acl;}
    static void PrepareInstallationBase(string path){SafePath(path);if(!Directory.Exists(path))Directory.CreateDirectory(path,DirectoryAcl(true));ValidateTrustedAcl(Directory.GetAccessControl(path));}
    static void ProtectCachedFile(string path){SafePath(path);ValidateTrustedAcl(File.GetAccessControl(path));var acl=new FileSecurity();acl.SetAccessRuleProtection(true,false);acl.SetOwner(new SecurityIdentifier("S-1-5-32-544"));foreach(string id in new[]{"S-1-5-32-544","S-1-5-18"})acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(id),FileSystemRights.FullControl,AccessControlType.Allow));File.SetAccessControl(path,acl);}
    static void ProtectDirectory(string path){SafePath(path);var acl=DirectoryAcl(false);if(!Directory.Exists(path))Directory.CreateDirectory(path,acl);ValidateTrustedAcl(Directory.GetAccessControl(path));Directory.SetAccessControl(path,acl);}
    static string SecureWorkspace(){string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ManagedOpenCodeSetup");ProtectDirectory(root);string path=Path.Combine(root,Guid.NewGuid().ToString("N"));ProtectDirectory(path);return path;}
    static void DeleteWorkspace(string path){SafePath(path);string root=Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),"ManagedOpenCodeSetup"))+Path.DirectorySeparatorChar;if(!Path.GetFullPath(path).StartsWith(root,StringComparison.OrdinalIgnoreCase))throw new IOException("Invalid setup workspace");if(Directory.Exists(path))Directory.Delete(path,true);}
}
